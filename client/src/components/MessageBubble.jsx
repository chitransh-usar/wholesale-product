import { Check, CheckCheck, Clock } from "lucide-react";

// status: 'sending' | 'sent' | 'read'
const StatusIcon = ({ status }) => {
	if (status === "sending") return <Clock className="w-3 h-3" />;
	if (status === "read") return <CheckCheck className="w-3 h-3 text-sky-300" />;
	return <Check className="w-3 h-3" />;
};

const formatTime = (iso) =>
	new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * props:
 * - message: { id, message_text, created_at, sender_id, status? }
 * - isOwn: boolean - sent by current user
 * - isFirstInGroup / isLastInGroup: boolean - controls corner rounding & tail
 * - showAvatar: boolean - only true on last message of a received group
 * - avatarLabel: string (initial)
 */
const MessageBubble = ({
	message,
	isOwn,
	isFirstInGroup = true,
	isLastInGroup = true,
	showAvatar = false,
	avatarLabel = "?",
}) => {
	const base =
		"max-w-[75%] sm:max-w-[65%] px-4 py-2.5 text-sm leading-relaxed break-words";

	const corners = isOwn
		? `rounded-2xl ${isLastInGroup ? "rounded-br-md" : "rounded-br-2xl"}`
		: `rounded-2xl ${isLastInGroup ? "rounded-bl-md" : "rounded-bl-2xl"}`;

	const spacing = isFirstInGroup ? "mt-3" : "mt-1";

	return (
		<div
			className={`flex items-end gap-2 ${spacing} ${isOwn ? "justify-end" : "justify-start"}`}
		>
			{/* avatar column - only rendered for received messages, reserved space always */}
			{!isOwn && (
				<div className="w-7 shrink-0">
					{showAvatar && (
						<div className="w-7 h-7 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-500">
							{avatarLabel}
						</div>
					)}
				</div>
			)}

			<div
				className={`group relative ${base} ${corners} ${
					isOwn
						? "bg-clay text-white shadow-sm shadow-clay/20"
						: "bg-white border border-slate-200 text-slate-800 shadow-sm"
				}`}
			>
				<p className="whitespace-pre-wrap">{message.message_text}</p>

				<div
					className={`mt-1 flex items-center gap-1 text-[10px] font-medium select-none ${
						isOwn ? "text-white/70 justify-end" : "text-slate-400 justify-end"
					}`}
				>
					<span>{formatTime(message.created_at)}</span>
					{isOwn && <StatusIcon status={message.status || "sent"} />}
				</div>
			</div>
		</div>
	);
};

export default MessageBubble;
