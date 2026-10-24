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
export function IconoExterno({ className }) {
  return (<svg {...base} className={className}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" /></svg>);
}
export function IconoNoticias({ className }) {
  return (<svg {...base} className={className}><path d="M4 4h12v16H6a2 2 0 0 1-2-2V4Z" /><path d="M16 8h3a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2M8 8h4M8 12h4M8 16h4" /></svg>);
}

// --- Íconos de métricas (mediciones del tótem) ---
export function IconoCorazon({ className }) {
  return (<svg {...base} className={className}><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3 5.5 5.5 0 0 0 12 5.5 5.5 5.5 0 0 0 7.5 3 5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z" /></svg>);
}
export function IconoPulso({ className }) {
  return (<svg {...base} className={className}><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>);
}
export function IconoGota({ className }) {
  return (<svg {...base} className={className}><path d="M12 2.5S5 10 5 14a7 7 0 0 0 14 0c0-4-7-11.5-7-11.5Z" /></svg>);
}
export function IconoBalanza({ className }) {
  return (<svg {...base} className={className}><path d="M5 8h14l-1.6 11.2a1 1 0 0 1-1 .8H7.6a1 1 0 0 1-1-.8L5 8Z" /><path d="M9 8a3 3 0 0 1 6 0" /><path d="M12 12v4" /></svg>);
}
export function IconoRegla({ className }) {
  return (<svg {...base} className={className}><path d="M3 9h18v6H3zM7 9v3M11 9v4M15 9v3M19 9v4" /></svg>);
}
export function IconoPersona({ className }) {
  return (<svg {...base} className={className}><circle cx="12" cy="6" r="3.2" /><path d="M6 22v-1.5a6 6 0 0 1 12 0V22" /></svg>);
}
export function IconoPesa({ className }) {
  return (<svg {...base} className={className}><path d="M6.5 6.5v11M3.5 9v6M17.5 6.5v11M20.5 9v6M6.5 12h11" /></svg>);
}
export function IconoRayo({ className }) {
  return (<svg {...base} className={className}><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" /></svg>);
}
