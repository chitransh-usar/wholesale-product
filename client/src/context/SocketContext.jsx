import { createContext, useContext, useEffect, useState } from "react";
import { io } from "socket.io-client";
import { useAuth } from "./AuthContext";

const SocketContext = createContext(null);

export const SocketProvider = ({ children }) => {
	const [socket, setSocket] = useState(null);
	// Take the token from auth state (not localStorage at render time) so that
	// logging in/out or switching accounts always rebuilds the socket. A stale
	// socket stays authenticated as the previous user, which makes the server
	// treat replies as "sending to yourself" and silently drop them.
	const { token, user } = useAuth();
	const userId = user?.id;

	useEffect(() => {
		if (!token) {
			setSocket(null);
			return;
		}

		const newSocket = io(
			import.meta.env.VITE_API_BASE_URL || "http://localhost:5000",
			{
				auth: { token },
				withCredentials: true,
			},
		);

		newSocket.on("connect_error", (err) => {
			console.error("Socket connection failed:", err.message);
		});

		setSocket(newSocket);

		return () => {
			newSocket.disconnect();
			setSocket(null);
		};
	}, [token, userId]);

	return (
		<SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
	);
};

export const useSocket = () => useContext(SocketContext);
