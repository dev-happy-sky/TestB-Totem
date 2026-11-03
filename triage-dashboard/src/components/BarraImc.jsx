// Barrita del IMC (sin el número: ese va en la celda IMC, junto al peso). Solo una barra
// que se llena y cambia de color según el estado, con la categoría al lado.
// Clasificación y colores según la tabla del ISSSTE (6 categorías).

const CATEGORIAS = [
  { max: 18.5, etiqueta: 'Peso bajo', texto: 'text-[#d97a2b]', linea: 'bg-[#e8883a]' },
  { max: 25, etiqueta: 'Peso normal', texto: 'text-[#1f93b5]', linea: 'bg-[#29abd4]' },
  { max: 30, etiqueta: 'Sobrepeso', texto: 'text-[#8a4486]', linea: 'bg-[#9c4e96]' },
  { max: 35, etiqueta: 'Obesidad I', texto: 'text-[#d01f27]', linea: 'bg-[#e0282e]' },
  { max: 40, etiqueta: 'Obesidad II', texto: 'text-[#359030]', linea: 'bg-[#3fa535]' },
  { max: Infinity, etiqueta: 'Obesidad III', texto: 'text-[#d97a2b]', linea: 'bg-[#f0962d]' },
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
  const pos = Math.min(100, Math.max(0, ((valor - 15) / 30) * 100));   // escala visual 15–45
  return (
    <div className="flex items-center gap-2" aria-label={`IMC: ${cat.etiqueta}`}>
      <div className="flex-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
        <div className={`h-full ${cat.linea} transition-all`} style={{ width: `${pos}%` }}></div>
      </div>
      <span className={`text-xs font-bold ${cat.texto}`}>{cat.etiqueta}</span>
    </div>
  );
}
