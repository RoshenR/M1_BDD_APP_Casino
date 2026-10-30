/**
 * Onglet « Mes stats » : le comportement de jeu, servi par MongoDB.
 *
 * Un seul document par joueur, une branche par jeu, et chaque branche a sa
 * propre forme. Les chiffres d'argent (mises, resultat net) restent ceux de
 * PostgreSQL, dans l'onglet Historique.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { SousLeCapot } from '../components/SousLeCapot';
import { jetons, signe } from '../lib/solde';

interface Stats {
  _id: number;
  pseudo: string;
  maj_le?: string;
  roulette?: {
    parties: number; gagnees: number; plus_gros_gain: number;
    numeros: Record<string, number>;
    couleurs: Record<string, number>;
    paris: Record<string, number>;
  };
  machine?: {
    parties: number; meilleur_multiplicateur: number;
    combinaisons: Record<string, number>;
  };
  blackjack?: {
    parties: number; depasses_21: number; croupier_depasse: number; doubles: number;
    somme_totaux: number; cartes_tirees: number;
    resultats: Record<string, number>;
  };
}

const ROUGES = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

const PARIS: Record<string, string> = {
  rouge: 'Rouge', noir: 'Noir', pair: 'Pair', impair: 'Impair',
  manque: '1 à 18', passe: '19 à 36', douzaine: 'Douzaines', colonne: 'Colonnes', plein: 'Numéros pleins',
};

const COMBINAISONS: [string, string][] = [
  ['trois sept', '7️⃣7️⃣7️⃣'],
  ['trois diamant', '💎💎💎'],
  ['trois cloche', '🔔🔔🔔'],
  ['trois pasteque', '🍉🍉🍉'],
  ['trois raisin', '🍇🍇🍇'],
  ['trois citron', '🍋🍋🍋'],
  ['trois cerise', '🍒🍒🍒'],
  ['paire', 'Une paire'],
  ['rien', 'Rien'],
];

const RESULTATS: [string, string][] = [
  ['blackjack', 'Blackjack'], ['gagne', 'Gagnées'], ['egalite', 'Égalités'], ['perdu', 'Perdues'],
];

const pct = (part: number, total: number) =>
  total > 0 ? `${Math.round((100 * part) / total).toLocaleString('fr-FR')} %` : '—';

/** Une barre horizontale proportionnelle : libelle, piste, valeur. */
function Barre({ libelle, valeur, max, total }: { libelle: string; valeur: number; max: number; total: number }) {
  return (
    <div className="barre barre--stats">
      <span>{libelle}</span>
      <div className="barre__piste">
        <div className="barre__rempli" style={{ width: `${max ? (100 * valeur) / max : 0}%`, background: 'var(--ivoire)' }} />
      </div>
      <span className="barre__valeur">{valeur.toLocaleString('fr-FR')} <span className="discret">({pct(valeur, total)})</span></span>
    </div>
  );
}

/* --- Roulette : le tapis colore par frequence de sortie ---------------------- */
function Roulette({ s }: { s: NonNullable<Stats['roulette']> }) {
  const max = Math.max(1, ...Object.values(s.numeros));
  const favori = Object.entries(s.numeros).sort((a, b) => b[1] - a[1])[0];
  const paris = Object.entries(s.paris).sort((a, b) => b[1] - a[1]);
  const totalCouleurs = Object.values(s.couleurs).reduce((a, b) => a + b, 0);

  return (
    <section className="section" aria-labelledby="st-roulette">
      <div className="compte__tete">
        <h2 id="st-roulette">Roulette</h2>
        <span className="discret">{s.parties.toLocaleString('fr-FR')} parties, {pct(s.gagnees, s.parties)} gagnées</span>
      </div>

      <p className="discret" style={{ marginTop: 0 }}>
        Les numéros qui vous sont sortis : plus la case est vive, plus il est sorti souvent.
        {favori && <> Votre numéro le plus fréquent est le <strong className="montant" style={{ color: 'var(--ivoire)' }}>{favori[0]}</strong>, sorti {favori[1]} fois.</>}
      </p>

      <div className="frequences" role="img" aria-label="Fréquence de sortie de chaque numéro">
        {Array.from({ length: 37 }, (_, n) => {
          const nb = s.numeros[String(n)] ?? 0;
          const couleur = n === 0 ? 'vert' : ROUGES.has(n) ? 'rouge' : 'noir';
          return (
            <span
              key={n}
              className={`frequence frequence--${couleur}`}
              style={{ opacity: nb === 0 ? 0.18 : 0.35 + 0.65 * (nb / max) }}
              title={`${n} : sorti ${nb} fois`}
            >
              {n}
            </span>
          );
        })}
      </div>

      <div className="colonnes" style={{ marginTop: '1.5rem' }}>
        <div>
          <h3 style={{ marginBottom: '0.5rem' }}>Couleurs sorties</h3>
          {(['rouge', 'noir', 'vert'] as const).map((c) => (
            <Barre key={c} libelle={c === 'vert' ? 'Zéro' : c[0]!.toUpperCase() + c.slice(1)}
                   valeur={s.couleurs[c] ?? 0} max={totalCouleurs} total={totalCouleurs} />
          ))}
        </div>
        <div>
          <h3 style={{ marginBottom: '0.5rem' }}>Vos paris</h3>
          {paris.map(([p, nb]) => (
            <Barre key={p} libelle={PARIS[p] ?? p} valeur={nb} max={paris[0]![1]} total={s.parties} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* --- Machine : quelles combinaisons, combien de fois ------------------------ */
function Machine({ s }: { s: NonNullable<Stats['machine']> }) {
  const max = Math.max(1, ...Object.values(s.combinaisons));
  return (
    <section className="section" aria-labelledby="st-machine">
      <div className="compte__tete">
        <h2 id="st-machine">Machine à sous</h2>
        <span className="discret">
          {s.parties.toLocaleString('fr-FR')} tours, meilleur coup : mise × {s.meilleur_multiplicateur}
        </span>
      </div>
      {COMBINAISONS.filter(([code]) => s.combinaisons[code]).map(([code, libelle]) => (
        <Barre key={code} libelle={libelle} valeur={s.combinaisons[code]!} max={max} total={s.parties} />
      ))}
    </section>
  );
}

/* --- Blackjack : comment se terminent vos mains ------------------------------ */
function Blackjack({ s }: { s: NonNullable<Stats['blackjack']> }) {
  const max = Math.max(1, ...Object.values(s.resultats));
  return (
    <section className="section" aria-labelledby="st-blackjack">
      <div className="compte__tete">
        <h2 id="st-blackjack">Blackjack</h2>
        <span className="discret">{s.parties.toLocaleString('fr-FR')} mains</span>
      </div>

      <dl className="chiffres" style={{ marginBottom: '1.5rem' }}>
        <div><dt>Total moyen de vos mains</dt><dd>{s.parties ? (s.somme_totaux / s.parties).toFixed(1).replace('.', ',') : '—'}</dd></div>
        <div><dt>Vous avez dépassé 21</dt><dd>{pct(s.depasses_21, s.parties)}</dd></div>
        <div><dt>Le croupier a dépassé 21</dt><dd>{pct(s.croupier_depasse, s.parties)}</dd></div>
        <div><dt>Mises doublées</dt><dd>{s.doubles.toLocaleString('fr-FR')}</dd></div>
      </dl>

      {RESULTATS.filter(([code]) => s.resultats[code]).map(([code, libelle]) => (
        <Barre key={code} libelle={libelle} valeur={s.resultats[code]!} max={max} total={s.parties} />
      ))}
    </section>
  );
}

/* --- Bilan croise : PostgreSQL (argent) + MongoDB (comportement) ------------- */
interface Bilan {
  source_postgres: { nb_parties: number; total_mise: number; resultat_net: number };
  coherence: { parties_postgres: number; parties_mongodb: number; synchronise: boolean };
}

function BilanCroise() {
  const [bilan, setBilan] = useState<Bilan | null>(null);

  useEffect(() => {
    api.get<Bilan>('/moi/bilan').then(setBilan).catch(() => setBilan(null));
  }, []);

  if (!bilan) return null;
  const { source_postgres: pg, coherence: c } = bilan;

  return (
    <section className="section" aria-labelledby="st-bilan">
      <div className="compte__tete">
        <h2 id="st-bilan">Bilan croisé</h2>
        <span className="discret">GET /moi/bilan · deux bases, un même identifiant joueur</span>
      </div>
      <dl className="chiffres">
        <div><dt>PostgreSQL · parties</dt><dd>{Number(pg.nb_parties).toLocaleString('fr-FR')}</dd></div>
        <div><dt>PostgreSQL · total misé</dt><dd>{jetons(pg.total_mise)}</dd></div>
        <div><dt>PostgreSQL · résultat net</dt><dd>{signe(Number(pg.resultat_net))}</dd></div>
        <div><dt>MongoDB · parties</dt><dd>{c.parties_mongodb.toLocaleString('fr-FR')}</dd></div>
        <div><dt>Cohérence</dt><dd>{c.synchronise ? '✓ synchronisé' : '⚠ écart'}</dd></div>
      </dl>
    </section>
  );
}

export function MesStats() {
  const [stats, setStats] = useState<Stats | null | undefined>(undefined);

  useEffect(() => {
    api.get<Stats | null>('/moi/stats-jeux').then(setStats).catch(() => setStats(null));
  }, []);

  if (stats === undefined) return <p className="discret">Chargement de vos statistiques…</p>;

  if (!stats || (!stats.roulette && !stats.machine && !stats.blackjack)) {
    return (
      <p className="vide">
        Vous n'avez encore joué à aucune table. Vos statistiques apparaîtront dès votre
        première partie. <Link to="/">Choisir une table</Link>
      </p>
    );
  }

  return (
    <>
      <BilanCroise />
      {stats.roulette && <Roulette s={stats.roulette} />}
      {stats.blackjack && <Blackjack s={stats.blackjack} />}
      {stats.machine && <Machine s={stats.machine} />}

      <SousLeCapot>
        <p>
          Ces statistiques viennent de <strong>MongoDB</strong>, pas de PostgreSQL. Elles
          tiennent dans un seul document par joueur, et chaque jeu y range des informations
          de forme différente : des numéros pour la roulette, des combinaisons pour la
          machine, des mains pour le blackjack. En SQL, il faudrait trois tables, ou une table
          clé/valeur fourre-tout.
        </p>
        <p>
          Après chaque partie, l'API fait un seul <code>updateOne</code> avec des{' '}
          <code>$inc</code> sur des clés dynamiques, comme <code>roulette.numeros.17</code>.
          L'opération est atomique côté serveur, sans schéma à prévoir.
        </p>
        <p>
          Ces chiffres ne sont pas comptables : les mises et les soldes font foi dans
          PostgreSQL. La collection est reconstructible à tout moment depuis les parties,
          avec la fonction SQL <code>export_stats_joueurs()</code>, qui fabrique directement
          les documents grâce à <code>jsonb_object_agg</code>. Les parties générées au
          démarrage n'ont qu'un état sommaire : au blackjack, on ne connaît pas leurs mains
          dépassées ni leurs doubles.
          {stats.maj_le && <> Dernière mise à jour : {new Date(stats.maj_le).toLocaleString('fr-FR')}.</>}
        </p>
        <details style={{ marginTop: '0.8rem' }}>
          <summary className="discret" style={{ cursor: 'pointer' }}>Voir le document brut</summary>
          <pre className="document-brut">{JSON.stringify(stats, null, 2)}</pre>
        </details>
      </SousLeCapot>
    </>
  );
}

