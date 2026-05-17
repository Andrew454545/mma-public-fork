import { Dialog, DialogContent } from "@/components/primitives/Dialog";
import { JsonEditorPanel } from "./JsonEditorPanel";

export function JsonEditorModal({ onClose }: { onClose: () => void }) {
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent title="JSON Editor" className="json-editor-modal">
				<JsonEditorPanel />
			</DialogContent>
		</Dialog>
	);
}
