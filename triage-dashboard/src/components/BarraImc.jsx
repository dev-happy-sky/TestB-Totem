// IMC estilo "barra de confianza": una barrita que se llena y cambia de color según el
// estado, con el valor y la condición al lado. Misma lógica que la app del tótem.

const CATEGORIAS = [
  { max: 18.5, etiqueta: 'Peso insuficiente', texto: 'text-blue-500', linea: 'bg-blue-400' },
  { max: 25, etiqueta: 'Normopeso', texto: 'text-green-600', linea: 'bg-green-500' },
  { max: 30, etiqueta: 'Sobrepeso', texto: 'text-yellow-500', linea: 'bg-yellow-500' },
  { max: 35, etiqueta: 'Obesidad', texto: 'text-orange-500', linea: 'bg-orange-500' },
  { max: Infinity, etiqueta: 'Obesidad mórbida', texto: 'text-red-600', linea: 'bg-red-500' },
];

function categoriaDe(imc) {
  let i = 0;
  while (i < CATEGORIAS.length - 1 && imc >= CATEGORIAS[i].max) i++;
  return CATEGORIAS[i];
}

export default function BarraImc({ imc }) {
  const valor = Number(imc);
  if (!Number.isFinite(valor) || valor <= 0) return null;
  const cat = categoriaDe(valor);
  const pos = Math.min(100, Math.max(0, ((valor - 15) / 25) * 100));   // escala visual 15–40
  return (
    <div className="flex items-center gap-2 text-xs font-bold text-slate-500" aria-label={`IMC ${valor.toFixed(1)}, ${cat.etiqueta}`}>
      IMC
      <div className="w-24 h-1.5 rounded-full bg-slate-200 overflow-hidden">
        <div className={`h-full ${cat.linea} transition-all`} style={{ width: `${pos}%` }}></div>
      </div>
      <span className={cat.texto}>{valor.toFixed(1)} · {cat.etiqueta}</span>
    </div>
  );
}
