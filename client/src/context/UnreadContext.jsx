/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useSocket } from "./SocketContext";
import { useAuth } from "./AuthContext";
import api from "../utils/axios";

const UnreadContext = createContext({ unreadCount: 0, refresh: () => {} });

/**
 * Tracks the total number of unread messages across every conversation so the
 * navbar can show a badge from anywhere in the app.
 */
export const UnreadProvider = ({ children }) => {
	const socket = useSocket();
	const { token } = useAuth();
	const [unreadCount, setUnreadCount] = useState(0);

	const refresh = useCallback(async () => {
		if (!token) {
			setUnreadCount(0);
			return;
		}
		try {
			const res = await api.get("/api/messages/chats");
			const chats = Array.isArray(res.data) ? res.data : [];
			setUnreadCount(
				chats.reduce((sum, c) => sum + (Number(c.unread) || 0), 0),
			);
		} catch {
			// non-critical: leave the previous count in place
		}
	}, [token]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	useEffect(() => {
		if (!socket) return;

		// A message addressed to us arrives -> bump immediately for instant feedback.
		const handleNewMessage = () => setUnreadCount((n) => n + 1);
		// Reading a conversation (or sending) changes counts -> resync from server.
		const handleRead = () => refresh();

		socket.on("new_message", handleNewMessage);
		socket.on("messages_read", handleRead);
		return () => {
			socket.off("new_message", handleNewMessage);
			socket.off("messages_read", handleRead);
		};
	}, [socket, refresh]);

	return (
		<UnreadContext.Provider value={{ unreadCount, refresh }}>
			{children}
		</UnreadContext.Provider>
	);
};

export const useUnread = () => useContext(UnreadContext);
