import { useState, useEffect } from "react";
import {
  Search,
  MoreVertical,
  Building2,
  MessageSquareText,
  Store,
  ArrowLeft,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useChatList } from "../hooks/useChatList";
import { useConversation } from "../hooks/useConversation";
import MessageBubble from "../components/MessageBubble";
import MessageInput from "../components/MessageInput";
import { Link, useLocation, useNavigate, useParams } from "react-router";

const timeAgo = (iso) => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return new Date(iso).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
};

const ChatListItem = ({ chat, active, onClick }) => (
  <div
    onClick={onClick}
    className={`p-4 border-b border-slate-100 cursor-pointer transition-colors ${
      active
        ? "bg-clay/5 border-l-2 border-l-clay"
        : "hover:bg-slate-50 border-l-2 border-l-transparent"
    }`}
  >
    <div className="flex justify-between items-start mb-1 gap-2">
      <h3 className="font-bold text-sm text-espresso truncate">
        {chat.sender_name}
      </h3>
      <span
        className={`text-[10px] font-semibold shrink-0 ${
          chat.unread ? "text-clay" : "text-slate-400"
        }`}
      >
        {chat.timestamp ? timeAgo(chat.timestamp) : ""}
      </span>
    </div>
    <div className="flex items-center gap-1.5 mb-2">
      <Building2 className="w-3 h-3 text-slate-400 shrink-0" />
      <span className="text-xs font-semibold text-slate-500 truncate">
        {chat.company}
      </span>
    </div>
    <div className="flex justify-between items-center gap-2">
      <p
        className={`text-xs truncate ${
          chat.unread ? "font-bold text-slate-800" : "text-slate-500"
        }`}
      >
        {chat.lastMessage || "No messages yet"}
      </p>
      {chat.unread > 0 && (
        <span className="w-4 h-4 bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center rounded-full shrink-0">
          {chat.unread}
        </span>
      )}
    </div>
  </div>
);

// Shown in the main panel whenever no conversation is open - either because
// nothing is selected yet, or because the user has no conversations at all.
const EmptyConversationState = ({ hasChats }) => (
  <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
    <div className="w-16 h-16 rounded-2xl bg-clay/10 flex items-center justify-center">
      <MessageSquareText className="w-8 h-8 text-clay" />
    </div>
    <div className="space-y-1.5">
      <h3 className="text-base font-black text-espresso">
        {hasChats ? "Select a conversation" : "No conversations yet"}
      </h3>
      <p className="max-w-xs text-xs leading-relaxed text-slate-500">
        {hasChats
          ? "Choose a chat from the list to read your messages and reply."
          : "Message a supplier from any product page and your conversations will show up here."}
      </p>
    </div>
    {!hasChats && (
      <Link
        to="/"
        className="mt-1 inline-flex items-center gap-2 rounded-lg bg-clay px-4 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-espresso"
      >
        <Store className="w-3.5 h-3.5" />
        Browse products
      </Link>
    )}
  </div>
);

const Messages = () => {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { vendorId } = useParams();
  // Messages renders in both the marketplace shell and the seller workspace;
  // keep navigation inside whichever one the user is currently in.
  const inSeller = location.pathname.startsWith("/seller");
  const basePath = inSeller ? "/seller/messages" : "/messages";
  // Fill the available height of the surrounding shell. The seller workspace
  // already owns the viewport (h-dvh, its own scroll container), so the panel
  // only subtracts that shell's header and padding; the marketplace subtracts
  // its navbar and page padding instead.
  const shellHeight = inSeller
    ? "h-[calc(100dvh-8rem)] sm:h-[calc(100dvh-9rem)] w-full max-w-none"
    : "h-[calc(100dvh-7rem)] max-w-6xl";
  const { chats, loading: chatsLoading, clearUnread } = useChatList();
  const [activeChatId, setActiveChatId] = useState(null);
  const [pendingChat, setPendingChat] = useState(null);
  const [search, setSearch] = useState("");

  const { messages, sendMessage } = useConversation(activeChatId, user?.id);

  useEffect(() => {
    // The URL is the source of truth. Without this the conversation stayed
    // open after the URL dropped the id (browser back), so the first back
    // press appeared to do nothing and only the second one left the page.
    if (!vendorId) {
      setActiveChatId(null);
      setPendingChat(null);
      return;
    }

    // A conversation with yourself is rejected by the server, so opening one
    // by URL would just render a permanently broken chat.
    if (user?.id != null && String(vendorId) === String(user.id)) {
      setActiveChatId(null);
      setPendingChat(null);
      navigate(basePath, { replace: true });
      return;
    }

    // FIX: Only trigger the pending chat and clear state IF state actually has data.
    // This stops the infinite loop caused by navigate() constantly generating new empty state objects.
    // ContactChoiceModal passes the vendor details nested under `openChat`.
    const openChat = location.state?.openChat;
    if (openChat) {
      setActiveChatId(vendorId);
      setPendingChat({
        user_id: vendorId,
        sender_name: openChat.vendorName || "Vendor",
        company: openChat.company,
        lastMessage: openChat.productName ? `Re: ${openChat.productName}` : "",
        timestamp: null,
        unread: 0,
      });

      // Clear the state so refreshing/back-nav doesn't re-trigger this
      navigate(location.pathname, { replace: true, state: {} });
    } else if (activeChatId !== vendorId) {
      // If the user lands on /messages/:vendorId directly via URL without state
      setActiveChatId(vendorId);
    }
  }, [vendorId, location.state, location.pathname, navigate, activeChatId, user?.id, basePath]);

  // No conversation is opened automatically - the empty state shows until the
  // user picks one from the list.

  // once the vendor shows up in the real chat list (message actually sent),
  // drop the synthetic pending entry and use the real one
  useEffect(() => {
    if (pendingChat && chats.some((c) => c.user_id === pendingChat.user_id)) {
      setPendingChat(null);
    }
  }, [chats, pendingChat]);

  // Deliberately no auto-scrolling: it fired inconsistently between
  // conversations and moved the view out from under the reader.

  const handleSelectChat = (userId) => {
    setActiveChatId(userId);
    // Keep the synthetic pending entry if it's the one being opened; only drop
    // it when switching to a different (real) conversation.
    setPendingChat((prev) => (prev && prev.user_id === userId ? prev : null));
    clearUnread(userId);
    navigate(`${basePath}/${userId}`);
  };

  // Mobile: return from a conversation to the conversation list
  const handleBackToList = () => {
    setActiveChatId(null);
    setPendingChat(null);
    navigate(basePath, { replace: true });
  };

  const activeChat =
    chats.find((c) => c.user_id === activeChatId) ??
    (pendingChat?.user_id === activeChatId ? pendingChat : null);

  const filteredChats = chats.filter((c) =>
    `${c.sender_name} ${c.company}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  if (chatsLoading) {
    return (
      <div className={`${shellHeight} mx-auto flex items-center justify-center text-sm text-slate-400`}>
        Loading messages...
      </div>
    );
  }

  return (
    <div
      className={`${shellHeight} mx-auto flex flex-col lg:flex-row bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden`}
    >
      {/* Sidebar - on mobile this and the conversation are alternating views,
          otherwise both share the fixed height and the composer is pushed
          off-screen. */}
      <div
        className={`${
          activeChat ? "hidden lg:flex" : "flex"
        } w-full lg:w-80 border-r border-slate-200 flex-col shrink-0 min-h-0`}
      >
        <div className="p-4 border-b border-slate-100">
          <h2 className="text-xl font-black text-espresso mb-4">Messages</h2>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search conversations..."
              className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:bg-white focus:border-clay focus:ring-1 focus:ring-clay outline-none transition-all"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {/* pending (new, unsaved) chat pinned at top */}
          {pendingChat && (
            <ChatListItem
              chat={pendingChat}
              active={activeChatId === pendingChat.user_id}
              onClick={() => handleSelectChat(pendingChat.user_id)}
            />
          )}

          {filteredChats.length === 0 && !pendingChat ? (
            <div className="p-8 text-center text-xs text-slate-400">
              {chats.length === 0 ? "No conversations yet" : "No matches found"}
            </div>
          ) : (
            filteredChats.map((chat) => (
              <ChatListItem
                key={chat.user_id}
                chat={chat}
                active={activeChatId === chat.user_id}
                onClick={() => handleSelectChat(chat.user_id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div
        className={`${
          activeChat ? "flex" : "hidden lg:flex"
        } flex-1 flex-col min-w-0 min-h-0 bg-slate-50/30`}
      >
        {activeChat ? (
          <>
            <div className="p-4 bg-white border-b border-slate-200 flex items-center justify-between shrink-0 shadow-sm z-10">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  onClick={handleBackToList}
                  aria-label="Back to conversations"
                  className="lg:hidden -ml-1 p-1.5 text-slate-500 hover:text-espresso hover:bg-slate-100 rounded-lg transition-colors shrink-0"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center text-slate-600 font-bold text-sm border border-slate-200 shrink-0">
                  {activeChat.sender_name?.[0] || "?"}
                </div>
                <div className="min-w-0">
                  <h3 className="font-black text-espresso text-base truncate">
                    {activeChat.sender_name}
                  </h3>
                  <p className="text-xs font-semibold text-slate-500 flex items-center gap-1.5 truncate">
                    <Building2 className="w-3 h-3 shrink-0" />
                    <span className="truncate">{activeChat.company}</span>
                  </p>
                </div>
              </div>
              <button className="p-2 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors">
                <MoreVertical className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 flex flex-col">
              {messages.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                  <MessageSquareText className="h-9 w-9 text-slate-200" />
                  <p className="text-xs text-slate-400">
                    Say hello to {activeChat.sender_name}
                  </p>
                </div>
              ) : (
                messages.map((msg, i) => {
                  const prev = messages[i - 1];
                  const next = messages[i + 1];
                  const isOwn = msg.sender_id === user?.id;
                  const isFirstInGroup =
                    !prev || prev.sender_id !== msg.sender_id;
                  const isLastInGroup =
                    !next || next.sender_id !== msg.sender_id;

                  return (
                    <MessageBubble
                      key={msg.id}
                      message={msg}
                      isOwn={isOwn}
                      isFirstInGroup={isFirstInGroup}
                      isLastInGroup={isLastInGroup}
                      showAvatar={!isOwn && isLastInGroup}
                      avatarLabel={activeChat.sender_name?.[0] || "?"}
                    />
                  );
                })
              )}
            </div>

            <div className="p-4 bg-white border-t border-slate-200 shrink-0">
              <MessageInput onSend={sendMessage} disabled={!activeChatId} />
            </div>
          </>
        ) : (
          <EmptyConversationState hasChats={chats.length > 0} />
        )}
      </div>
    </div>
  );
};

export default Messages;
