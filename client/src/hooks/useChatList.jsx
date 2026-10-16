import { useState, useEffect, useCallback } from "react";
import { useSocket } from "../context/SocketContext";
import api from "../utils/axios";

export function useChatList() {
	const socket = useSocket();
	const [chats, setChats] = useState([]);
	const [loading, setLoading] = useState(true);

	// `background` refreshes (after sending/receiving) must not flip the loading
	// flag - the page swaps to a full-screen loader and visibly flashes.
	const fetchChats = useCallback(async ({ background = false } = {}) => {
		if (!background) setLoading(true);
		try {
			const res = await api.get(`/api/messages/chats`);
			setChats(Array.isArray(res.data) ? res.data : []);
		} catch (err) {
			console.error("Failed to fetch chats", err);
		} finally {
			if (!background) setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchChats();
	}, [fetchChats]);

	// Keep sidebar live: bump unread + reorder when a message arrives anywhere
	useEffect(() => {
		if (!socket) return;

		const handleNewMessage = (msg) => {
			setChats((prev) => {
				const exists = prev.some(
					(c) => c.user_id === msg.sender_id || c.user_id === msg.receiver_id,
				);
				// message from/ to someone not yet in the list (new conversation) -> refetch
				if (!exists) {
					fetchChats({ background: true });
					return prev;
				}
				const updated = prev.map((chat) =>
					chat.user_id === msg.sender_id
						? {
								...chat,
								lastMessage: msg.message_text,
								timestamp: msg.created_at,
								unread: Number(chat.unread) + 1,
							}
						: chat,
				);
				return [...updated].sort(
					(a, b) => new Date(b.timestamp) - new Date(a.timestamp),
				);
			});
		};

		// When *we* send a message (especially the first one in a brand-new
		// conversation), refresh so the chat shows up as a real conversation
		// instead of only the synthetic pending entry.
		const handleMessageSent = () => fetchChats({ background: true });

		socket.on("new_message", handleNewMessage);
		socket.on("message_sent", handleMessageSent);
		return () => {
			socket.off("new_message", handleNewMessage);
			socket.off("message_sent", handleMessageSent);
		};
	}, [socket, fetchChats]);

	// call this when the user opens a conversation, to zero out its unread badge locally
	const clearUnread = useCallback((userId) => {
		setChats((prev) =>
			prev.map((c) => (c.user_id === userId ? { ...c, unread: 0 } : c)),
		);
	}, []);

	return { chats, loading, clearUnread, refetch: fetchChats };
}
