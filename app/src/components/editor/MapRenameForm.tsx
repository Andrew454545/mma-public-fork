import { updateMapMeta } from "@/store/useMapStore";
import { useId, useState } from "react";
import { useCloseDialog } from "../primitives/Dialog";

export function MapRenameForm({ currentName }: { currentName: string }) {
	const id = useId();
	const close = useCloseDialog();
	const [name, setName] = useState(currentName);
	return (
		<form
			className="edit-map-modal__rename"
			onSubmit={(e) => {
				e.preventDefault();
				updateMapMeta({ name: name || currentName });
				close();
			}}
		>
			<p className="edit-map-modal__name">
				<label htmlFor={`${id}name`}>Map name:</label>
				<input
					id={`${id}name`}
					className="input"
					type="text"
					value={name}
					onChange={(e) => setName(e.target.value)}
					minLength={1}
					maxLength={100}
					autoFocus
				/>
			</p>
			<div className="edit-map-modal__actions">
				<button
					type="submit"
					className="button button--primary"
					disabled={name.trim().length === 0}
				>
					Save
				</button>
			</div>
		</form>
	);
}
