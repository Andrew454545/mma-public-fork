interface IconProps {
	path: string;
	size?: number;
	className?: string;
	style?: React.CSSProperties;
}

export function Icon({ path, size = 24, className, style }: IconProps) {
	return (
		<svg height={size} width={size} viewBox="0 0 24 24" className={className} style={style}>
			<path d={path} />
		</svg>
	);
}
