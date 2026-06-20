import { useState } from "react";
import type { Tag } from "@/bindings.gen";
import { getTagCounts } from "@/store/useMapStore";
import { sortTagsByMode, tagChipStyle, appendTagName } from "@/lib/util/util";
import { textColorFor } from "@/lib/util/color";
import { useSetting } from "@/store/settings";

export function FullscreenTagBar({
	pendingTags,
	onChangeTags,
	tags,
}: {
	pendingTags: string[];
	onChangeTags: (tags: string[]) => void;
	tags: Tag[];
}) {
	const [input, setInput] = useState("");
	const [focused, setFocused] = useState(false);
	const tagSortMode = useSetting("tagSortMode");

	const handleAdd = (e: React.FormEvent) => {
		e.preventDefault();
		const name = input.trim();
		if (!name) return;
		onChangeTags(appendTagName(pendingTags, name, tags));
		setInput("");
	};

	const toggleTag = (t: Tag) => {
		const lower = t.name.toLowerCase();
		if (pendingTags.some((n) => n.toLowerCase() === lower)) {
			onChangeTags(pendingTags.filter((n) => n.toLowerCase() !== lower));
		} else {
			onChangeTags([...pendingTags, t.name]);
		}
		setInput("");
	};

	const pendingLower = new Set(pendingTags.map((n) => n.toLowerCase()));
	const sorted = sortTagsByMode(tags, tagSortMode, getTagCounts());
	const available = sorted.filter((t) => !pendingLower.has(t.name.toLowerCase()));
	const filtered = input.trim()
		? available.filter((t) => t.name.toLowerCase().includes(input.toLowerCase()))
		: available;

	return (
		<div className="fullscreen-tagbar">
			<ul className="tag-list">
				{pendingTags.map((name) => (
					<li key={name} className="tag is-small has-button" style={tagChipStyle(name, tags)}>
						<button
							className="button tag__button tag__button--delete"
							onClick={() => onChangeTags(pendingTags.filter((n) => n !== name))}
							type="button"
						>
							<svg height="16" width="16" viewBox="0 0 24 24" fill="currentColor">
								<path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z" />
							</svg>
						</button>
						<span className="tag__text">{name}</span>
					</li>
				))}
			</ul>
			<form className="form-add-tag" onSubmit={handleAdd}>
				<button className="button form-add-tag__button" type="submit">
					+
				</button>
				<input
					className="form-add-tag__input fullscreen-tagbar__input"
					type="text"
					placeholder="Add a tag..."
					spellCheck={false}
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onFocus={() => setFocused(true)}
					onBlur={() => setTimeout(() => setFocused(false), 150)}
				/>
			</form>
			{focused && filtered.length > 0 && (
				<div className="fullscreen-tagbar__palette">
					{filtered.map((t) => (
						<button
							key={t.id}
							className="tag is-small fullscreen-tagbar__palette-tag"
							style={{ backgroundColor: t.color, color: textColorFor(t.color) }}
							onMouseDown={(e) => {
								e.preventDefault(); // keep the input focused so the palette stays open
								toggleTag(t);
							}}
							type="button"
						>
							<span className="tag__text">{t.name}</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
