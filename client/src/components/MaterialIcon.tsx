import React from 'react';

type MaterialIconProps = {
  name: string;
  size?: number;
  className?: string;
  title?: string;
  ariaHidden?: boolean;
  filled?: boolean;
};

const MaterialIcon: React.FC<MaterialIconProps> = ({ name, size, className, title, ariaHidden = true, filled = false }) => {
  const style: React.CSSProperties = {};
  if (size) style.fontSize = size;
  if (filled) style.fontVariationSettings = "'FILL' 1, 'wght' 500, 'GRAD' 0, 'opsz' 24";
  return (
    <span
      className={`material-symbols-outlined${className ? ` ${className}` : ''}`}
      style={Object.keys(style).length ? style : undefined}
      aria-hidden={ariaHidden}
      title={title}
    >
      {name}
    </span>
  );
};

export default MaterialIcon;
