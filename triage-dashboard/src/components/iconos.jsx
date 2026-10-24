// Íconos en línea (sin dependencias externas). stroke="currentColor" para heredar color.
import React from 'react';

const base = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2,
  strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
};

export function IconoMancuerna({ className }) {
  return (<svg {...base} className={className}><path d="M6.5 6.5v11M3.5 9v6M17.5 6.5v11M20.5 9v6M6.5 12h11" /></svg>);
}
export function IconoUsuario({ className }) {
  return (<svg {...base} className={className}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>);
}
export function IconoCandado({ className }) {
  return (<svg {...base} className={className}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>);
}
export function IconoOjo({ className }) {
  return (<svg {...base} className={className}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>);
}
export function IconoOjoTachado({ className }) {
  return (<svg {...base} className={className}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-8-10-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22" /></svg>);
}
export function IconoInicio({ className }) {
  return (<svg {...base} className={className}><path d="M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5" /></svg>);
}
export function IconoPanel({ className }) {
  return (<svg {...base} className={className}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M3 9h6" /></svg>);
}
export function IconoAlumnos({ className }) {
  return (<svg {...base} className={className}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>);
}
export function IconoAlerta({ className }) {
  return (<svg {...base} className={className}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" /><path d="M12 9v4M12 17h.01" /></svg>);
}
export function IconoCheck({ className }) {
  return (<svg {...base} className={className}><path d="M20 6 9 17l-5-5" /></svg>);
}
export function IconoReloj({ className }) {
  return (<svg {...base} className={className}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>);
}
export function IconoFlecha({ className }) {
  return (<svg {...base} className={className}><path d="M5 12h14M13 6l6 6-6 6" /></svg>);
}
