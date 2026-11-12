// Phase 1: dritte (verlinkende) Kachel im Grid rendern + Kachel-Gesamtzahl.
import { readFileSync, writeFileSync } from 'node:fs';

const file = 'src/routes/app/new-project.tsx';
let src = readFileSync(file, 'utf8');
const before = src.length;

// 1) data-Attribut: Gesamtzahl der SICHTBAREN Kacheln (Beweis-Marker).
const attrOld = 'data-strategy-tile-count={STRATEGY_TILE_COUNT}';
if (!src.includes(attrOld)) throw new Error('tile-count attr missing');
src = src.replace(attrOld, 'data-strategy-tile-count={STRATEGY_TILE_COUNT_ALL}');

// 2) Verlinkende Kachel (TikTok) nach den generierenden Kacheln rendern.
const gridClose = `            );
          })}
        </div>`;
if (!src.includes(gridClose)) throw new Error('grid close anchor missing');
const linkTiles = `            );
          })}
          {/* Phase 1 (Owner-Freigabe 2026-11-11): dritte Kachel = TikTok. Sie
              generiert hier nichts, sondern fuehrt in das bestehende
              TikTok-Modul (Skript mit Zeitangaben, kein Video). */}
          {STRATEGY_LINK_TILES.map((tile) => (
            <Link
              key={tile.key}
              to={tile.href}
              data-strategy-tile-link={tile.key}
              className="relative flex flex-col items-center gap-1.5 rounded-xl border-2 border-gray-200 bg-white p-4 text-center transition-all hover:-translate-y-0.5 hover:shadow-sm"
            >
              <span className="text-2xl">{tile.icon}</span>
              <span className="text-xs font-semibold leading-tight text-gray-700">
                {t[tile.labelKey]}
              </span>
              <span className="text-[10px] leading-tight text-gray-400 line-clamp-2">
                {t[tile.descKey]}
              </span>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500">
                {t.strategy_open_module}
              </span>
            </Link>
          ))}
        </div>`;
src = src.replace(gridClose, linkTiles);

writeFileSync(file, src);
console.log(`${file}: ${before} -> ${src.length} Zeichen`);
