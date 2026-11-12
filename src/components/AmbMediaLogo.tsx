import React, { useState, useId } from 'react';

export interface AmbMediaLogoProps {
  size?: number | string;
  className?: string;
  iconClassName?: string;
  showWordmark?: boolean;
  title?: string;
  subtitle?: string;
  animate?: boolean;
  clickable?: boolean;
  onClick?: () => void;
}

export const AmbMediaLogo: React.FC<AmbMediaLogoProps> = ({
  size = 36,
  className = '',
  iconClassName = '',
  showWordmark = false,
  title = 'AMB Media',
  subtitle = 'AI Video Generator',
  animate = true,
  clickable = true,
  onClick,
}) => {
  const [isPlaying, setIsPlaying] = useState(animate);
  const clipId = useId();

  const handleReplay = (e: React.MouseEvent) => {
    if (onClick) {
      onClick();
    }
    if (!clickable) return;
    setIsPlaying(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setIsPlaying(true);
      });
    });
  };

  const parsedSize = typeof size === 'number' ? `${size}px` : size;

  return (
    <div
      className={`amb-logo-stage inline-flex items-center gap-3 select-none ${isPlaying ? 'play' : ''} ${clickable ? 'cursor-pointer group' : ''} ${className}`}
      onClick={handleReplay}
      title={clickable ? 'AMB Media - Klik untuk memutar animasi logo' : 'AMB Media'}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={(e) => {
        if (clickable && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          handleReplay(e as any);
        }
      }}
    >
      <svg
        className={`amb-logo-svg block shrink-0 transition-transform duration-200 group-hover:scale-105 ${iconClassName}`}
        width={parsedSize}
        height={parsedSize}
        style={{ width: parsedSize, height: parsedSize }}
        viewBox="0 0 120 120"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Logo AMB Media"
      >
        <defs>
          <clipPath id={clipId}>
            <rect width="120" height="120" rx="30" />
          </clipPath>
        </defs>

        {/* Tile Background with Gold Border */}
        <g className="amb-tile">
          <rect className="amb-logo-tbg" width="120" height="120" rx="30" />
          <rect
            x="1"
            y="1"
            width="118"
            height="118"
            rx="29"
            fill="none"
            stroke="#F59E0B"
            strokeOpacity="0.45"
            strokeWidth="2"
          />
        </g>

        {/* 6 Masonry Cards */}
        {/* Col 1 */}
        <g className="amb-drop" style={{ '--d': '0.35s', '--dy': '-26px' } as React.CSSProperties}>
          <rect className="amb-bob amb-logo-k1" style={{ '--bd': '2.0s' } as React.CSSProperties} x="24" y="24" width="20" height="36" rx="7" />
        </g>
        <g className="amb-drop" style={{ '--d': '0.8s', '--dy': '26px' } as React.CSSProperties}>
          <rect className="amb-bob amb-logo-k2" style={{ '--bd': '3.05s' } as React.CSSProperties} x="24" y="66" width="20" height="30" rx="7" />
        </g>

        {/* Col 2 */}
        <g className="amb-drop" style={{ '--d': '0.5s', '--dy': '-26px' } as React.CSSProperties}>
          <rect className="amb-bob amb-logo-k3" style={{ '--bd': '2.35s' } as React.CSSProperties} x="50" y="24" width="20" height="24" rx="7" />
        </g>
        <g className="amb-drop" style={{ '--d': '0.95s', '--dy': '26px' } as React.CSSProperties}>
          <rect className="amb-bob amb-logo-k4" style={{ '--bd': '3.4s' } as React.CSSProperties} x="50" y="54" width="20" height="42" rx="7" />
        </g>

        {/* Col 3 */}
        <g className="amb-drop" style={{ '--d': '0.65s', '--dy': '-26px' } as React.CSSProperties}>
          <rect className="amb-bob amb-logo-k5" style={{ '--bd': '2.7s' } as React.CSSProperties} x="76" y="24" width="20" height="44" rx="7" />
        </g>
        <g className="amb-drop" style={{ '--d': '1.1s', '--dy': '26px' } as React.CSSProperties}>
          <rect className="amb-bob amb-logo-k6" style={{ '--bd': '3.75s' } as React.CSSProperties} x="76" y="74" width="20" height="22" rx="7" />
        </g>

        {/* Ripple */}
        <g clipPath={`url(#${clipId})`}>
          <circle className="amb-rp amb-logo-rp" cx="86" cy="46" r="8" />
        </g>

        {/* Play Button */}
        <g className="amb-pop">
          <polygon
            className="amb-pulse amb-logo-pl"
            points="82,39 82,53 92,46"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </g>
      </svg>

      {showWordmark && (
        <div className="flex flex-col justify-center leading-none">
          <h1 className="amb-nm font-serif-display text-lg font-normal text-stone-900 dark:text-stone-100 tracking-tight leading-none whitespace-nowrap">
            {title.split('').map((char, i) => (
              <span key={i} className="inline-block" style={{ '--i': i } as React.CSSProperties}>
                {char === ' ' ? '\u00A0' : char}
              </span>
            ))}
          </h1>
          {subtitle && (
            <p className="amb-tag font-sans-body text-[11px] text-stone-500 dark:text-stone-400 font-light mt-1 tracking-wide">
              {subtitle}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default AmbMediaLogo;
