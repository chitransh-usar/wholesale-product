function registerGracefulShutdown({
  io,
  pool,
  processRef = process,
  logger = console,
}) {
  let shutdownPromise;

  const shutdown = (signal) => {
    if (shutdownPromise) return shutdownPromise;

    logger.info(`Received ${signal}. Closing Socket.IO and the database pool.`);
    shutdownPromise = (async () => {
      const failures = [];

      try {
        await new Promise((resolve, reject) => {
          io.close((error) => (error ? reject(error) : resolve()));
        });
      } catch (error) {
        failures.push(error);
      }

      try {
        await pool.end();
      } catch (error) {
        failures.push(error);
      }

      if (failures.length) {
        const reasons = failures
          .map((error) => error.code || error.name || "unknown error")
          .join(", ");
        logger.error(`Graceful shutdown failed: ${reasons}.`);
        processRef.exitCode = 1;
        return;
      }

      logger.info("Graceful shutdown complete.");
    })();

    return shutdownPromise;
  };

  for (const signal of ["SIGTERM", "SIGINT"]) {
    processRef.once(signal, () => {
      shutdown(signal);
    });
  }

  return shutdown;
}

module.exports = registerGracefulShutdown;
