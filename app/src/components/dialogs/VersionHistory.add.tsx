import { useEffect, useState, type ReactNode } from "react";
import { Dialog, DialogContent } from "@/components/primitives/Dialog";
import { useCurrentMap, checkoutCommit } from "@/store/useMapStore";
import * as vcs from "@/lib/storage/vcs";
import type { CommitInfo } from "@/types";

const fmt = new Intl.NumberFormat("en");
const dateFmt = new Intl.DateTimeFormat("en", {
	dateStyle: "medium",
	timeStyle: "short",
});

function diffLabel(c: CommitInfo): ReactNode | null {
	const parts: ReactNode[] = [];
	if (c.added > 0)
		parts.push(
			<span key="a" style={{ color: "var(--green-11)" }}>
				+{c.added}
			</span>,
		);
	if (c.removed > 0)
		parts.push(
			<span key="r" style={{ color: "var(--red-11)" }}>
				-{c.removed}
			</span>,
		);
	if (c.modified > 0)
		parts.push(
			<span key="m" style={{ color: "var(--amber-11)" }}>
				~{c.modified}
			</span>,
		);
	return parts.length > 0 ? (
		<span style={{ display: "inline-flex", gap: 6, fontFamily: "monospace" }}>{parts}</span>
	) : null;
}

export function VersionHistory({ onClose }: { onClose: () => void }) {
	const map = useCurrentMap();
	const [commits, setCommits] = useState<CommitInfo[]>([]);
	const [loading, setLoading] = useState(true);
	const [restoring, setRestoring] = useState<string | null>(null);

	useEffect(() => {
		if (!map) return;
		vcs.listCommits(map.meta.id).then((c) => {
			setCommits(c);
			setLoading(false);
		});
	}, [map?.meta.id]);

	if (!map || loading) return null;

	const handleRestore = async (commit: CommitInfo, isLatest: boolean) => {
		const label = vcs.shortHash(commit.id);
		const action = isLatest ? "Discard uncommitted changes?" : `Restore to ${label}?`;
		if (!confirm(`${action} Current state will be saved as a new commit.`)) return;
		setRestoring(commit.id);
		await checkoutCommit(commit.id);
		setRestoring(null);
		onClose();
	};

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent title="Version history" className="version-history-modal">
				{commits.length === 0 && (
					<p style={{ color: "var(--stone-9)" }}>
						No commits yet. Press Commit to create your first version.
					</p>
				)}
				{commits.length > 0 && (
					<div style={{ maxHeight: 400, overflowY: "auto" }}>
						<table style={{ width: "100%", borderCollapse: "collapse" }}>
							<thead>
								<tr
									style={{
										textAlign: "left",
										borderBottom: "1px solid var(--stone-5)",
									}}
								>
									<th style={{ padding: "6px 8px" }}>Date</th>
									<th style={{ padding: "6px 8px" }}>Hash</th>
									<th style={{ padding: "6px 8px" }}>Changes</th>
									<th style={{ padding: "6px 8px", textAlign: "right" }}>Locations</th>
									<th style={{ padding: "6px 8px" }}></th>
								</tr>
							</thead>
							<tbody>
								{commits.map((c, i) => {
									const diff = diffLabel(c);
									const msg = c.message;
									return (
										<tr key={c.id} style={{ borderBottom: "1px solid var(--stone-3)" }}>
											<td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
												{dateFmt.format(new Date(c.createdAt))}
											</td>
											<td
												style={{
													padding: "6px 8px",
													fontFamily: "monospace",
													fontSize: "0.85em",
													color: "var(--stone-9)",
												}}
											>
												{vcs.shortHash(c.id)}
											</td>
											<td
												style={{
													padding: "6px 8px",
													color: diff ? undefined : msg ? undefined : "var(--stone-7)",
												}}
											>
												{diff ?? msg ?? (i === 0 ? "(latest)" : "(snapshot)")}
											</td>
											<td style={{ padding: "6px 8px", textAlign: "right" }}>
												{fmt.format(c.locationCount)}
											</td>
											<td style={{ padding: "6px 8px" }}>
												<button
													className="button"
													disabled={restoring !== null}
													onClick={() => handleRestore(c, i === 0)}
												>
													{restoring === c.id ? "Restoring..." : i === 0 ? "Revert" : "Restore"}
												</button>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
