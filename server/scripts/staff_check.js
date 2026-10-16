/**
 * Can an employee work on their employer's book, and only their employer's?
 *
 * The whole feature is one substitution: seller screens must read the business
 * being acted for, not the person signed in. For an owner the two are the same
 * id, which is why `req.user.id` was doing both jobs and why getting it wrong
 * is invisible in every test that only has owners in it.
 *
 * So every check here uses two wholesalers with real books, and asserts both
 * halves: the employee sees their employer's rows, and they never sees the other
 * wholesaler's. A leak in the wrong direction is the whole risk of this
 * feature, and it would look exactly like the feature working.
 *
 *     node scripts/staff_check.js <database>
 */
const Module = require("module");
const { Pool } = require("pg");

const DB = process.argv[2] || "qa_staff";
const dbPath = require.resolve("../src/config/db");
const testPool = new Pool({ connectionString: `postgres://postgres@127.0.0.1:5433/${DB}` });
const stub = new Module(dbPath, null);
stub.exports = testPool;
stub.loaded = true;
require.cache[dbPath] = stub;

const staff = require("../src/controllers/staffController");
const parties = require("../src/controllers/partyController");
const sales = require("../src/controllers/saleController");
const overview = require("../src/controllers/overviewController");
const auth = require("../src/controllers/authController");
const partyService = require("../src/services/partyService");
const saleService = require("../src/services/orderSaleService");
const {
  resolveBusiness,
  resetStaffTable,
  requirePermission,
  requireOwner,
} = require("../src/middlewares/businessContext");
const { DEFAULT_PERMISSIONS, PERMISSION_KEYS } = require("../src/services/staffAccess");

const mk = () => {
  const r = { statusCode: 200, body: null };
  r.status = (c) => ((r.statusCode = c), r);
  r.json = (b) => ((r.body = b), r);
  return r;
};

let fails = 0;
const check = (cond, label, v) => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"} ${String(label).padEnd(56)} ${JSON.stringify(v ?? "")}`);
};
const q = (sql, args) => testPool.query(sql, args);

/**
 * Drives a handler the way the app does: resolve the business first, then run
 * whatever gates the route carries, then the handler. Testing the handler
 * alone would skip exactly the middleware this feature is made of.
 */
const asUser = async (user, handler, req = {}, gates = []) => {
  const r = mk();
  const request = { user, params: {}, query: {}, body: {}, ...req };
  await new Promise((done) => resolveBusiness(request, r, done));

  // The gates are synchronous, so this is a plain call. Waiting on a promise
  // that resolves in next() hangs the moment a gate refuses, which is the
  // only interesting case.
  for (const gate of gates) {
    let passed = false;
    gate(request, r, () => { passed = true; });
    if (!passed) return r;
  }
  await handler(request, r);
  return r;
};

const stamp = Date.now();
let seq = 0;
const mkUser = async (name, role, phone) =>
  (await q(
    `INSERT INTO users (first_name,last_name,email,role,phone,password_hash)
     VALUES ($1,'T',$2,$3,$4,'x') RETURNING id`,
    [name, `staff${stamp}${seq++}@x.local`, role, phone],
  )).rows[0].id;

(async () => {
  console.log(`\n=== staff accounts, ${DB} ===`);
  partyService.resetPartyLink();
  saleService.resetSaleLink();
  resetStaffTable();

  // Two wholesalers, each with their own book. The second exists only so every
  // check can also assert that the employee cannot see it.
  const ramId = await mkUser("Ram", "seller", "9000000001");
  const shyamId = await mkUser("Shyam", "seller", "9000000002");
  for (const [id, firm] of [[ramId, "Ram Textiles"], [shyamId, "Shyam Mills"]]) {
    await q(
      `INSERT INTO wholesaler_profiles (user_id, company_name, upi_id, contact_phone, city, gstin)
       VALUES ($1,$2,'x@upi','9000000001','Surat','24AAAAA0000A1Z8')`,
      [id, firm],
    );
  }
  const ram = { id: ramId, role: "seller" };
  const shyam = { id: shyamId, role: "seller" };

  const ramCustomer = await asUser(ram, parties.createParty, {
    body: { name: `Ram's customer ${stamp}`, phone: "9820000001" },
  });
  const shyamCustomer = await asUser(shyam, parties.createParty, {
    body: { name: `Shyam's customer ${stamp}`, phone: "9820000002" },
  });
  check(ramCustomer.statusCode === 201 && shyamCustomer.statusCode === 201,
    "two wholesalers, one customer each", {});

  // ---- inviting -----------------------------------------------------------
  const invited = await asUser(ram, staff.inviteStaff, {
    body: { name: "Kishan Nephew", phone: "9820011223" },
  });
  check(invited.statusCode === 201, "the owner can invite somebody", { s: invited.statusCode });
  const kishan = invited.body?.staff;
  check(kishan?.status === "invited", "who starts as invited", { s: kishan?.status });
  check(!!kishan?.inviteCode, "with a code to read out to them", { has: Boolean(kishan?.inviteCode) });
  check(
    JSON.stringify(kishan?.permissions) === JSON.stringify(DEFAULT_PERMISSIONS),
    "and everything ticked by default",
    { got: kishan?.permissions?.length, want: DEFAULT_PERMISSIONS.length },
  );

  const noName = await asUser(ram, staff.inviteStaff, { body: { phone: "98200" } });
  check(noName.statusCode === 400, "a person needs a name", { s: noName.statusCode });
  const noContact = await asUser(ram, staff.inviteStaff, { body: { name: "Nobody" } });
  check(noContact.statusCode === 400, "and a way to be reached", { s: noContact.statusCode });

  // ---- accepting ----------------------------------------------------------
  const badCode = await asUser(null, staff.acceptInvite, {
    body: { code: "not-a-real-code", password: "longenough1" },
  });
  check(badCode.statusCode === 400, "a wrong code is refused", { s: badCode.statusCode });

  const shortPass = await asUser(null, staff.acceptInvite, {
    body: { code: kishan.inviteCode, password: "short" },
  });
  check(shortPass.statusCode === 400, "and a short password", { s: shortPass.statusCode });

  const accepted = await asUser(null, staff.acceptInvite, {
    body: { code: kishan.inviteCode, password: "kishan-password-1", email: `kishan${stamp}@x.local` },
  });
  check(accepted.statusCode === 201, "the code makes them an account", { s: accepted.statusCode, b: accepted.body });

  const reuse = await asUser(null, staff.acceptInvite, {
    body: { code: kishan.inviteCode, password: "another-password", email: `again${stamp}@x.local` },
  });
  check(reuse.statusCode === 400, "and cannot be used a second time", { s: reuse.statusCode });

  const kishanUserId = (await q(
    "SELECT user_id FROM staff_members WHERE id = $1", [kishan.id],
  )).rows[0].user_id;
  const kishanUser = { id: kishanUserId, role: "seller" };

  // ---- the substitution that is the whole feature -------------------------
  const their = await asUser(kishanUser, parties.listParties, {}, [requirePermission("customers")]);
  const names = (their.body || []).map((p) => p.name);
  check(their.statusCode === 200, "the employee can open the customer book", { s: their.statusCode });
  check(names.includes(`Ram's customer ${stamp}`),
    "and it is their employer's book", { names });
  check(!names.includes(`Shyam's customer ${stamp}`),
    "not the other wholesaler's", { names });
  check(names.length === 1, "and nothing else", { n: names.length });

  const ownBook = await asUser(shyam, parties.listParties, {}, [requirePermission("customers")]);
  check((ownBook.body || []).length === 1 &&
        ownBook.body[0].name === `Shyam's customer ${stamp}`,
    "the other wholesaler is unaffected", { n: (ownBook.body || []).length });

  // Writing lands in the employer's book too, not in a book of their own.
  const wrote = await asUser(kishanUser, parties.createParty, {
    body: { name: `Added by the nephew ${stamp}`, phone: "9820011999" },
  }, [requirePermission("customers")]);
  check(wrote.statusCode === 201, "they can add a customer", { s: wrote.statusCode });
  const owner = (await q(
    "SELECT wholesaler_id FROM parties WHERE name = $1", [`Added by the nephew ${stamp}`],
  )).rows[0];
  check(String(owner?.wholesaler_id) === String(ramId),
    "and it belongs to their employer, not to them", { got: owner?.wholesaler_id, want: ramId });

  // ---- what they may do is changeable ---------------------------------------
  const narrowed = await asUser(ram, staff.updateStaff, {
    params: { id: kishan.id },
    body: { permissions: ["orders", "sales"] },
  });
  check(narrowed.statusCode === 200, "the owner can change what they may do", { s: narrowed.statusCode });
  check(JSON.stringify(narrowed.body?.staff?.permissions) === JSON.stringify(["orders", "sales"]),
    "to exactly what was asked for", { p: narrowed.body?.staff?.permissions });

  const nowRefused = await asUser(kishanUser, parties.listParties, {}, [requirePermission("customers")]);
  check(nowRefused.statusCode === 403, "and the customer book closes to them", { s: nowRefused.statusCode });
  check(nowRefused.body?.code === "NOT_ALLOWED", "with a reason, not a redirect", nowRefused.body);

  const stillSales = await asUser(kishanUser, sales.listSales, {}, [requirePermission("sales")]);
  check(stillSales.statusCode === 200, "while what they kept still works", { s: stillSales.statusCode });

  const junk = await asUser(ram, staff.updateStaff, {
    params: { id: kishan.id },
    body: { permissions: ["orders", "make-me-the-owner", "sales"] },
  });
  check(JSON.stringify(junk.body?.staff?.permissions) === JSON.stringify(["orders", "sales"]),
    "an invented permission is dropped rather than stored", { p: junk.body?.staff?.permissions });

  // Widened again, and the money one specifically.
  await asUser(ram, staff.updateStaff, {
    params: { id: kishan.id }, body: { permissions: PERMISSION_KEYS },
  });

  // ---- the money block ----------------------------------------------------
  const withMoney = await asUser(kishanUser, overview.getOverview);
  check(withMoney.body?.money !== null && withMoney.body?.money !== undefined,
    "with the money permission they see the figures", { m: withMoney.body?.money });

  await asUser(ram, staff.updateStaff, {
    params: { id: kishan.id },
    body: { permissions: PERMISSION_KEYS.filter((k) => k !== "money") },
  });
  const noMoney = await asUser(kishanUser, overview.getOverview);
  check(noMoney.statusCode === 200, "without it the screen still opens", { s: noMoney.statusCode });
  check(noMoney.body?.money === null,
    "but the money is withheld rather than shown as nought", { m: noMoney.body?.money });
  check(Array.isArray(noMoney.body?.toDeliver),
    "and the work they are there to do is still listed", { n: noMoney.body?.toDeliver?.length });
  const breakdown = await asUser(kishanUser, overview.getBreakdown,
    { query: { metric: "outstanding" } }, [requirePermission("money")]);
  check(breakdown.statusCode === 403, "the breakdown page is closed to them", { s: breakdown.statusCode });

  // ---- what nobody may do -------------------------------------------------
  const staffList = await asUser(kishanUser, staff.listStaff, {}, [requireOwner]);
  check(staffList.statusCode === 403,
    "an employee cannot see or manage the staff list", { s: staffList.statusCode });
  check(staffList.body?.code === "OWNER_ONLY", "because it is owner only", staffList.body);
  const selfPromote = await asUser(kishanUser, staff.updateStaff,
    { params: { id: kishan.id }, body: { permissions: PERMISSION_KEYS } }, [requireOwner]);
  check(selfPromote.statusCode === 403, "so they cannot widen their own permissions", { s: selfPromote.statusCode });

  // ---- the owner sees everyone --------------------------------------------
  await asUser(ram, staff.inviteStaff, { body: { name: "Second Man", phone: "9820022334" } });
  const list = await asUser(ram, staff.listStaff, {}, [requireOwner]);
  check(list.statusCode === 200, "the owner sees their staff", { s: list.statusCode });
  check((list.body?.staff || []).length === 2, "both of them", { n: (list.body?.staff || []).length });
  check((list.body?.permissions || []).length === PERMISSION_KEYS.length,
    "with the catalogue of what can be granted", { n: (list.body?.permissions || []).length });

  const shyamList = await asUser(shyam, staff.listStaff, {}, [requireOwner]);
  check((shyamList.body?.staff || []).length === 0,
    "and the other wholesaler sees none of them", { n: (shyamList.body?.staff || []).length });

  const notMine = await asUser(shyam, staff.updateStaff, {
    params: { id: kishan.id }, body: { permissions: [] },
  }, [requireOwner]);
  check(notMine.statusCode === 404,
    "nor can they touch another wholesaler's employee", { s: notMine.statusCode });

  // ---- turning somebody off ----------------------------------------------
  const off = await asUser(ram, staff.setStaffStatus, {
    params: { id: kishan.id }, body: { status: "disabled" },
  }, [requireOwner]);
  check(off.statusCode === 200, "the owner can turn them off", { s: off.statusCode });

  const afterOff = await asUser(kishanUser, parties.listParties, {}, [requirePermission("customers")]);
  check(afterOff.statusCode === 403,
    "and they can no longer open the book", { s: afterOff.statusCode });
  const stillThere = await q("SELECT COUNT(*)::int AS n FROM parties WHERE name = $1",
    [`Added by the nephew ${stamp}`]);
  check(stillThere.rows[0].n === 1,
    "while the work they did is still there", { n: stillThere.rows[0].n });

  const back = await asUser(ram, staff.setStaffStatus, {
    params: { id: kishan.id }, body: { status: "active" },
  }, [requireOwner]);
  check(back.statusCode === 200, "and they can be turned back on", { s: back.statusCode });

  // ---- invited by email alone ---------------------------------------------
  // users.phone is NOT NULL. Every invite in this file used to carry a phone,
  // so accepting one that did not failed on a database constraint the employee
  // could do nothing about, and nothing here noticed.
  const byEmail = (await asUser(ram, staff.inviteStaff, {
    body: { name: "Email Only", email: `emailonly${stamp}@x.local` },
  }, [requireOwner])).body.staff;
  check(!byEmail.phone, "somebody can be invited with only an email", { p: byEmail.phone });

  const noPhone = await asUser(null, staff.acceptInvite, {
    body: { code: byEmail.inviteCode, password: "email-only-pass" },
  });
  check(noPhone.statusCode === 400,
    "and is asked for a phone number rather than failing", { s: noPhone.statusCode, b: noPhone.body });

  const withPhone = await asUser(null, staff.acceptInvite, {
    body: { code: byEmail.inviteCode, password: "email-only-pass", phone: "9820055667" },
  });
  check(withPhone.statusCode === 201, "giving one completes the join", { s: withPhone.statusCode, b: withPhone.body });

  const stored = (await q(
    `SELECT u.phone, u.email, s.phone AS staff_phone
       FROM staff_members s JOIN users u ON u.id = s.user_id WHERE s.id = $1`,
    [byEmail.id],
  )).rows[0];
  check(stored?.phone === "9820055667", "their number is on their account", { p: stored?.phone });
  check(stored?.staff_phone === "9820055667",
    "and on the owner's list, so it reaches them", { p: stored?.staff_phone });

  // The other way round: a phone on the invite, nothing typed at join.
  const byPhone = (await asUser(ram, staff.inviteStaff, {
    body: { name: "Phone Only", phone: "9820066778" },
  }, [requireOwner])).body.staff;
  const usedOwners = await asUser(null, staff.acceptInvite, {
    body: { code: byPhone.inviteCode, password: "phone-only-pass", email: `phoneonly${stamp}@x.local` },
  });
  check(usedOwners.statusCode === 201,
    "a phone the owner entered is enough on its own", { s: usedOwners.statusCode });

  // ---- who am I ------------------------------------------------------------
  const me = await asUser(kishanUser, auth.getMe);
  check(me.body?.staff?.isOwner === false, "the employee is told they are not the owner", me.body?.staff);
  check(me.body?.staff?.worksFor === "Ram Textiles",
    "and whose book they have open", { w: me.body?.staff?.worksFor });
  const ownerMe = await asUser(ram, auth.getMe);
  check(ownerMe.body?.staff?.isOwner === true, "an owner is told they are one", ownerMe.body?.staff);
  check(ownerMe.body?.staff?.worksFor === null, "with no employer named", ownerMe.body?.staff);

  // ---- an invite turned off can be brought back ---------------------------
  // The trap this replaced: turning off somebody who had not yet used their code
  // left them unreachable. The row sat disabled, the button was refused every
  // time, and a second invite under a second row was the only way out.
  const pending = (await asUser(ram, staff.inviteStaff, {
    body: { name: "Never Joined", phone: "9820033445" },
  }, [requireOwner])).body.staff;
  const firstCode = pending.inviteCode;

  const cancelled = await asUser(ram, staff.setStaffStatus, {
    params: { id: pending.id }, body: { status: "disabled" },
  }, [requireOwner]);
  check(cancelled.statusCode === 200, "an unused invite can be cancelled", { s: cancelled.statusCode });
  check(cancelled.body?.staff?.status === "disabled", "and goes to turned off", { s: cancelled.body?.staff?.status });

  const deadCode = await asUser(null, staff.acceptInvite, {
    body: { code: firstCode, password: "some-long-password", email: `dead${stamp}@x.local` },
  });
  check(deadCode.statusCode === 400, "the cancelled code stops working", { s: deadCode.statusCode });

  const revived = await asUser(ram, staff.setStaffStatus, {
    params: { id: pending.id }, body: { status: "active" },
  }, [requireOwner]);
  check(revived.statusCode === 200, "and they can be invited again", { s: revived.statusCode });
  check(revived.body?.staff?.status === "invited",
    "back to waiting rather than working, since they never joined",
    { s: revived.body?.staff?.status });
  check(!!revived.body?.staff?.inviteCode && revived.body.staff.inviteCode !== firstCode,
    "with a fresh code, because the old one may have expired", {});

  const joinedLate = await asUser(null, staff.acceptInvite, {
    body: { code: revived.body.staff.inviteCode, password: "late-password-1", email: `late${stamp}@x.local` },
  });
  check(joinedLate.statusCode === 201, "and the new code works", { s: joinedLate.statusCode });

  // ---- removing somebody for good -----------------------------------------
  const doomed = (await asUser(ram, staff.inviteStaff, {
    body: { name: "Wrong Number", phone: "9820099887" },
  }, [requireOwner])).body.staff;
  const gone = await asUser(ram, staff.removeStaff, { params: { id: doomed.id } }, [requireOwner]);
  check(gone.statusCode === 200, "an invite sent to the wrong number can be removed", { s: gone.statusCode });
  const left = await asUser(ram, staff.listStaff, {}, [requireOwner]);
  check(!(left.body?.staff || []).some((p) => p.id === doomed.id),
    "and they are off the list", { n: (left.body?.staff || []).length });

  // Somebody who did work can go too, and their work stays.
  const worked = await q("SELECT COUNT(*)::int AS n FROM parties WHERE name = $1",
    [`Added by the nephew ${stamp}`]);
  const removedWorker = await asUser(ram, staff.removeStaff,
    { params: { id: kishan.id } }, [requireOwner]);
  check(removedWorker.statusCode === 200, "so can somebody who has worked", { s: removedWorker.statusCode });
  const afterRemoval = await q("SELECT COUNT(*)::int AS n FROM parties WHERE name = $1",
    [`Added by the nephew ${stamp}`]);
  check(afterRemoval.rows[0].n === worked.rows[0].n,
    "and the customer they added is untouched", { before: worked.rows[0].n, after: afterRemoval.rows[0].n });

  const notMineToRemove = await asUser(shyam, staff.removeStaff,
    { params: { id: pending.id } }, [requireOwner]);
  check(notMineToRemove.statusCode === 404,
    "another wholesaler cannot remove your staff", { s: notMineToRemove.statusCode });


  console.log(fails ? `\n${fails} FAILED\n` : "\nall good\n");
  await testPool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("THREW", e); process.exit(1); });
