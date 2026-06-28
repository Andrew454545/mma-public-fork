import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ReactElement } from "react";

type Side = "top" | "bottom" | "left" | "right";
type Align = "start" | "center" | "end";

export function Tooltip({
	content,
	side = "top",
	align = "center",
	children,
}: {
	content: string;
	side?: Side;
	align?: Align;
	children: ReactElement;
}) {
	return (
		<RadixTooltip.Root>
			<RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
			<RadixTooltip.Portal>
				<RadixTooltip.Content className="tooltip" side={side} align={align} sideOffset={5}>
					{content}
					<RadixTooltip.Arrow className="tooltip__arrow" />
				</RadixTooltip.Content>
			</RadixTooltip.Portal>
		</RadixTooltip.Root>
	);
}

export function TooltipProvider({ children }: { children: React.ReactNode }) {
	return (
		<RadixTooltip.Provider delayDuration={0} skipDelayDuration={300} disableHoverableContent>
			{children}
		</RadixTooltip.Provider>
	);
}
