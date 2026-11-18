/* фон страницы входа: полупрозрачные схемы из технологии разработки ПО —
   диаграмма классов, каскадная модель жизненного цикла, диаграмма прецедентов, блок IDEF0. Только украшение */

const Arrow = ({ id }: { id: string }) => (
  <defs>
    <marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 10 5 0 10z" className="bd__head" />
    </marker>
  </defs>
);

/* диаграмма классов UML: «Курс» 1 — 1..* «Модуль» */
const Classes = () => (
  <svg className="bd bd--classes" viewBox="0 0 480 150">
    <rect x="1" y="1" width="190" height="132" rx="6" />
    <line x1="1" y1="35" x2="191" y2="35" />
    <line x1="1" y1="93" x2="191" y2="93" />
    <text x="96" y="24" textAnchor="middle" className="bd__name">
      Курс
    </text>
    <text x="13" y="58">− название</text>
    <text x="13" y="81">− статус</text>
    <text x="13" y="117">+ опубликовать()</text>
    <line x1="191" y1="67" x2="300" y2="67" />
    <text x="198" y="59" className="bd__small">
      1
    </text>
    <text x="270" y="59" className="bd__small">
      1..*
    </text>
    <rect x="300" y="31" width="176" height="110" rx="6" />
    <line x1="300" y1="65" x2="476" y2="65" />
    <text x="388" y="54" textAnchor="middle" className="bd__name">
      Модуль
    </text>
    <text x="312" y="89">− цель</text>
    <text x="312" y="125">+ открыть()</text>
  </svg>
);

/* каскадная модель жизненного цикла ПО */
const STAGES = ['Анализ', 'Проектирование', 'Реализация', 'Тестирование', 'Сопровождение'];
const Lifecycle = () => (
  <svg className="bd bd--life" viewBox="0 0 400 310">
    <Arrow id="bd-arrow-life" />
    {STAGES.map((s, i) => (
      <g key={s} transform={`translate(${i * 55 + 1}, ${i * 60 + 1})`}>
        <rect width="170" height="38" rx="8" />
        <text x="85" y="25" textAnchor="middle">
          {s}
        </text>
        {i < STAGES.length - 1 && <path d="M170 19 H200 V60" markerEnd="url(#bd-arrow-life)" />}
      </g>
    ))}
  </svg>
);

/* диаграмма прецедентов: учащийся и два прецедента в границах системы */
const UseCases = () => (
  <svg className="bd bd--usecase" viewBox="0 0 310 214">
    <circle cx="30" cy="52" r="11" />
    <path d="M30 63 V100 M12 76 H48 M30 100 L16 128 M30 100 L44 128" />
    <text x="30" y="150" textAnchor="middle">
      Учащийся
    </text>
    <rect x="96" y="6" width="210" height="200" rx="10" />
    <text x="108" y="28" className="bd__small">
      Платформа
    </text>
    <ellipse cx="200" cy="80" rx="86" ry="23" />
    <text x="200" y="85" textAnchor="middle">
      Пройти тест
    </text>
    <ellipse cx="200" cy="158" rx="86" ry="23" />
    <text x="200" y="163" textAnchor="middle">
      Сдать работу
    </text>
    <path d="M48 76 L114 80 M48 76 L114 154" />
  </svg>
);

/* функциональный блок IDEF0: вход слева, выход справа, управление сверху, механизм снизу */
const Idef = () => (
  <svg className="bd bd--idef" viewBox="0 0 310 224">
    <Arrow id="bd-arrow-idef" />
    <rect x="96" y="72" width="130" height="72" rx="3" />
    <text x="161" y="113" textAnchor="middle" className="bd__name">
      Обучение
    </text>
    <text x="218" y="138" textAnchor="end" className="bd__small">
      A0
    </text>
    <path d="M161 8 V72" markerEnd="url(#bd-arrow-idef)" />
    <text x="168" y="22" className="bd__small">
      Программа
    </text>
    <path d="M4 108 H96" markerEnd="url(#bd-arrow-idef)" />
    <text x="6" y="100" className="bd__small">
      Материалы
    </text>
    <path d="M226 108 H306" markerEnd="url(#bd-arrow-idef)" />
    <text x="234" y="100" className="bd__small">
      Отметки
    </text>
    <path d="M161 216 V144" markerEnd="url(#bd-arrow-idef)" />
    <text x="168" y="206" className="bd__small">
      Преподаватель
    </text>
  </svg>
);

export const AuthBackdrop = () => (
  <div className="backdrop" aria-hidden="true">
    <Classes />
    <Lifecycle />
    <UseCases />
    <Idef />
  </div>
);
