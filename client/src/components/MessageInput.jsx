import { useRef, useEffect, useState } from "react";
import { Paperclip, Send, Smile } from "lucide-react";

const MAX_LENGTH = 2000;

/**
 * props:
 * - onSend: (text: string) => void
 * - disabled: boolean - e.g. no active chat selected
 * - sending: boolean - briefly true right after send, for button feedback
 * - onAttach: optional (file: File) => void
 */
const MessageInput = ({
	onSend,
	disabled = false,
	sending = false,
	onAttach,
}) => {
	const [value, setValue] = useState("");
	const textareaRef = useRef(null);
	const fileInputRef = useRef(null);

	// auto-grow, capped
	useEffect(() => {
		const el = textareaRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
	}, [value]);

	const commit = () => {
		const text = value.trim();
		if (!text || disabled) return;
		onSend(text);
		setValue("");
		textareaRef.current?.focus();
	};

	const handleKeyDown = (e) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			commit();
		}
	};

	const handleFileChange = (e) => {
		const file = e.target.files?.[0];
		if (file && onAttach) onAttach(file);
		e.target.value = "";
	};

	const nearLimit = value.length > MAX_LENGTH - 100;

	return (
		<div className="shrink-0">
			<div
				className={`flex items-end gap-1.5 rounded-xl border bg-slate-50 p-2 transition-all ${
					disabled
						? "border-slate-200 opacity-60"
						: "border-slate-200 focus-within:border-clay focus-within:ring-1 focus-within:ring-clay focus-within:bg-white"
				}`}
			>
				<input
					ref={fileInputRef}
					type="file"
					className="hidden"
					onChange={handleFileChange}
				/>
				<button
					type="button"
					disabled={disabled}
					onClick={() => fileInputRef.current?.click()}
					className="p-2 text-slate-400 hover:text-clay hover:bg-white rounded-lg transition-colors shrink-0 disabled:cursor-not-allowed disabled:hover:text-slate-400 disabled:hover:bg-transparent"
					aria-label="Attach file"
				>
					<Paperclip className="w-[18px] h-[18px]" />
				</button>

				<textarea
					ref={textareaRef}
					rows={1}
					value={value}
					disabled={disabled}
					maxLength={MAX_LENGTH}
					placeholder={
						disabled
							? "Select a conversation to start messaging"
							: "Type your message..."
					}
					onChange={(e) => setValue(e.target.value)}
					onKeyDown={handleKeyDown}
					className="flex-1 max-h-32 bg-transparent border-none resize-none text-sm text-slate-900 placeholder:text-slate-400 py-2 px-1 outline-none focus:ring-0 disabled:cursor-not-allowed"
				/>

				<button
					type="button"
					disabled={disabled}
					className="p-2 text-slate-400 hover:text-clay hover:bg-white rounded-lg transition-colors shrink-0 disabled:cursor-not-allowed disabled:hover:text-slate-400 disabled:hover:bg-transparent hidden sm:block"
					aria-label="Emoji"
				>
					<Smile className="w-[18px] h-[18px]" />
				</button>

				<button
					type="button"
					onClick={commit}
					disabled={disabled || !value.trim()}
					className="p-2.5 bg-clay text-white hover:bg-espresso disabled:bg-slate-200 disabled:text-slate-400 rounded-lg transition-colors shrink-0 shadow-sm disabled:shadow-none"
					aria-label="Send message"
				>
					<Send
						className={`w-4 h-4 transition-transform ${sending ? "scale-90" : ""}`}
					/>
				</button>
			</div>

			{nearLimit && (
				<p className="mt-1 text-right text-[10px] font-medium text-slate-400">
					{value.length}/{MAX_LENGTH}
				</p>
			)}
		</div>
	);
};

export default MessageInput;
