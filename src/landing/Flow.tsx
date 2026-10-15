import { Logo } from "#/components/brand";

type Box = readonly [x: number, y: number, w: number, h: number];

type Tone = "ok" | "bad" | "gone";

type Layout = {
  viewBox: string;
  issues: Box;
  box: Box;
  rowX: number;
  rowW: number;
  rowY: readonly number[];
  rowH: number;
  agents: readonly [Box, Box];
  fixes: Box;
  wires: { in: string; agents: readonly [string, string]; out: readonly string[] };
};

const rows: { name: string; status: [text: string, tone?: Tone][]; gone?: boolean }[] = [
  {
    name: "#212 hang",
    status: [
      ["reproduced", "bad"],
      [", fixed", "ok"],
    ],
  },
  { name: "#213 retry", status: [["already fixed", "gone"]], gone: true },
  {
    name: "#214 cold start",
    status: [
      ["reproduced", "bad"],
      [", fixed", "ok"],
    ],
  },
  { name: "#215 crash", status: [["couldn't reproduce"]] },
];

const agents = [
  { name: "Claude Code", icon: "https://cdn.simpleicons.org/claude", task: "#212" },
  {
    name: "Codex",
    icon: "https://cdn.jsdelivr.net/npm/simple-icons@9.0.0/icons/openai.svg",
    task: "#214",
  },
] as const;

// Positions in each viewBox. Wires are drawn in order: issues in, the two agents, then both fixes out.
const layouts: Record<"lg" | "sm", Layout> = {
  lg: {
    viewBox: "0 16 960 276",
    issues: [8, 115, 170, 70],
    box: [200, 30, 330, 250],
    rowX: 218,
    rowW: 294,
    rowY: [80, 130, 180, 230],
    rowH: 40,
    agents: [
      [580, 68, 170, 64],
      [580, 168, 170, 64],
    ],
    fixes: [790, 110, 154, 80],
    wires: {
      in: "M178 150 L200 150",
      agents: ["M512 100 L580 100", "M512 200 L580 200"],
      out: ["M750 100 L770 100 L770 150 L790 150", "M750 200 L770 200 L770 150 L790 150"],
    },
  },
  sm: {
    viewBox: "0 0 360 600",
    issues: [95, 8, 170, 60],
    box: [16, 100, 328, 250],
    rowX: 30,
    rowW: 300,
    rowY: [146, 194, 242, 290],
    rowH: 40,
    agents: [
      [16, 400, 156, 64],
      [188, 400, 156, 64],
    ],
    fixes: [103, 516, 154, 72],
    wires: {
      in: "M180 68 L180 100",
      agents: ["M94 350 L94 400", "M266 350 L266 400"],
      out: ["M94 464 L94 490 L180 490 L180 516", "M266 464 L266 490 L180 490 L180 516"],
    },
  },
};

const merge =
  "M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0 0 .005V3.25Z";

// A dashed wire with a dash travelling along it; the delay staggers wires so the flow reads in order.
function Wire({ d, delay }: { d: string; delay: number }) {
  return (
    <>
      <path className="wire" d={d} />
      <path className="comet" d={d} pathLength={100} style={{ animationDelay: `${delay}ms` }} />
    </>
  );
}

function Tile({
  at: [x, y, w, h],
  title,
  sub,
  className,
  icon,
}: {
  at: Box;
  title: string;
  sub: string;
  className?: string;
  icon?: string;
}) {
  return (
    <g className={className}>
      <rect className="tile" x={x} y={y} width={w} height={h} />
      {icon && (
        <foreignObject x={x + 13} y={y + h / 2 - 18} width={16} height={16}>
          <Logo src={icon} className="block size-4 text-muted-foreground" />
        </foreignObject>
      )}
      <text className="title" x={x + (icon ? 36 : 14)} y={y + h / 2 - 4}>
        {title}
      </text>
      <text className="sub" x={x + 14} y={y + h / 2 + 15}>
        {sub}
      </text>
    </g>
  );
}

function Diagram({ size, L }: { size: "lg" | "sm"; L: Layout }) {
  const [bx, by, bw, bh] = L.box;
  const [px, py, pw, ph] = L.fixes;

  return (
    <svg className={size} viewBox={L.viewBox}>
      <rect className="box" x={bx} y={by} width={bw} height={bh} />
      <text className="box-name" x={L.rowX} y={L.rowY[0] - 14}>
        forkin
      </text>
      <text className="hint" x={L.rowX + L.rowW} y={L.rowY[0] - 14} textAnchor="end">
        your issues
      </text>
      <Wire d={L.wires.in} delay={0} />
      {L.wires.agents.map((d) => (
        <Wire key={d} d={d} delay={900} />
      ))}
      {L.wires.out.map((d) => (
        <Wire key={d} d={d} delay={1800} />
      ))}
      <Tile at={L.issues} title="New issues" sub="with failing tests" />
      {rows.map((r, i) => (
        <g key={r.name} className={r.gone ? "row gone" : "row"}>
          <rect className="tile" x={L.rowX} y={L.rowY[i]} width={L.rowW} height={L.rowH} />
          <text className="name" x={L.rowX + 14} y={L.rowY[i] + 25}>
            {r.name}
          </text>
          <text className="status" x={L.rowX + L.rowW - 14} y={L.rowY[i] + 25} textAnchor="end">
            {r.status.map(([text, tone]) => (
              <tspan key={text} className={tone}>
                {text}
              </tspan>
            ))}
          </text>
        </g>
      ))}
      {agents.map((a, i) => (
        <Tile
          key={a.name}
          at={L.agents[i]}
          title={a.name}
          sub={`fixed ${a.task}`}
          className="done"
          icon={a.icon}
        />
      ))}
      <g className="fixes">
        <rect className="tile" x={px} y={py} width={pw} height={ph} />
        <path
          className="merge"
          d={merge}
          transform={`translate(${px + 16} ${py + ph / 2 - 9}) scale(1.125)`}
        />
        <text className="title" x={px + 44} y={py + ph / 2 + 5}>
          Verified fixes
        </text>
      </g>
    </svg>
  );
}

// Figure 1: a batch of issues, already triaged and fixed, drawn in a wide and a narrow layout.
export function Flow() {
  return (
    <div
      className="flow"
      role="img"
      aria-label="New issues arrive with failing tests. Forkin runs each one: #212 and #214 are reproduced and go to Claude Code and Codex, each in its own fork; #213 was already fixed on main; #215 could not be reproduced. Both fixes are proven, ready for the maintainer to approve."
    >
      <Diagram size="lg" L={layouts.lg} />
      <Diagram size="sm" L={layouts.sm} />
    </div>
  );
}
