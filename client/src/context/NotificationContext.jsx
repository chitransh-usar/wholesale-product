import { createContext, useContext, useEffect, useMemo, useState } from "react";
import api from "../utils/axios";
import { useSocket } from "./SocketContext";
import { useAuth } from "./AuthContext";

const NotificationContext = createContext(null);

export const NotificationProvider = ({ children }) => {
  const { user } = useAuth();
  const socket = useSocket();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [preferences, setPreferences] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({
    search: "",
    type: "",
    startDate: "",
    endDate: "",
  });

  const loadNotifications = async (options = {}) => {
    if (!user) return;
    setIsLoading(true);
    try {
      const query = new URLSearchParams({
        page: options.page || page,
        limit: options.limit || 20,
        search: options.search ?? filters.search,
        type: options.type ?? filters.type,
        startDate: options.startDate ?? filters.startDate,
        endDate: options.endDate ?? filters.endDate,
      });
      const response = await api.get(`/api/notifications?${query.toString()}`);
      setNotifications(response.data.notifications || []);
      setTotal(response.data.total || 0);
      setPage(response.data.page || 1);
    } catch (error) {
      console.error("Failed to load notifications", error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadUnreadCount = async () => {
    if (!user) return;
    try {
      const response = await api.get("/api/notifications/unread");
      setUnreadCount((response.data.unread || []).length);
    } catch (error) {
      console.error("Failed to load unread notifications", error);
    }
  };

  const loadPreferences = async () => {
    if (!user) return;
    try {
      const response = await api.get("/api/notifications/preferences");
      setPreferences(response.data.preferences);
    } catch (error) {
      console.error("Failed to load notification preferences", error);
    }
  };

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      setUnreadCount(0);
      setPreferences(null);
      return;
    }
    loadNotifications({ page: 1 });
    loadUnreadCount();
    loadPreferences();
  }, [user]);

  useEffect(() => {
    if (!socket) return undefined;

    const handleNotification = (notification) => {
      setNotifications((prev) => [notification, ...prev]);
      setUnreadCount((prev) => prev + 1);
    };

    const handleCount = (payload) => {
      if (payload?.unreadCount !== undefined) {
        setUnreadCount(payload.unreadCount);
      }
    };

    socket.on("notification", handleNotification);
    socket.on("notification_count", handleCount);

    return () => {
      socket.off("notification", handleNotification);
      socket.off("notification_count", handleCount);
    };
  }, [socket]);

  const markRead = async (id) => {
    try {
      await api.patch(`/api/notifications/${id}/read`);
      setNotifications((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, is_read: true } : item,
        ),
      );
      setUnreadCount((prev) => Math.max(prev - 1, 0));
    } catch (error) {
      console.error("Failed to mark notification read", error);
    }
  };

  const markAllRead = async () => {
    try {
      await api.patch("/api/notifications/read-all");
      setNotifications((prev) =>
        prev.map((item) => ({ ...item, is_read: true })),
      );
      setUnreadCount(0);
    } catch (error) {
      console.error("Failed to mark all notifications read", error);
    }
  };

  const deleteNotification = async (id) => {
    try {
      await api.delete(`/api/notifications/${id}`);
      setNotifications((prev) => prev.filter((item) => item.id !== id));
    } catch (error) {
      console.error("Failed to delete notification", error);
    }
  };

  const updatePreferences = async (payload) => {
    try {
      const response = await api.put("/api/notifications/preferences", payload);
      if (response.data.success) {
        loadPreferences();
      }
    } catch (error) {
      console.error("Failed to update notification preferences", error);
    }
  };

  const registerDeviceToken = async (token, platform) => {
    try {
      await api.post("/api/notifications/device-token", { token, platform });
    } catch (error) {
      console.error("Failed to register device token", error);
    }
  };

  const removeDeviceToken = async (token) => {
    try {
      await api.delete("/api/notifications/device-token", { data: { token } });
    } catch (error) {
      console.error("Failed to remove device token", error);
    }
  };

  const value = useMemo(
    () => ({
      notifications,
      unreadCount,
      preferences,
      isLoading,
      page,
      total,
      filters,
      setFilters,
      loadNotifications,
      loadUnreadCount,
      markRead,
      markAllRead,
      deleteNotification,
      updatePreferences,
      registerDeviceToken,
      removeDeviceToken,
    }),
    [notifications, unreadCount, preferences, isLoading, page, total, filters],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => useContext(NotificationContext);
export { NotificationContext };
