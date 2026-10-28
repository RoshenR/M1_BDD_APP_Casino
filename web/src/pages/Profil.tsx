import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, session } from '../lib/api';
import { jetons, signe, useSolde } from '../lib/solde';
import { useToast } from '../lib/toast';
import { SousLeCapot } from '../components/SousLeCapot';
import { MesStats } from './MesStats';

interface Compte {
  joueur_id: number;
  pseudo: string;
  email: string;
  solde: number;
  statut: string;
  parraine_par: string | null;
  limite_mise: number | null;
  exclu_jusqu_au: string | null;
  inscrit_le: string;
}

interface Stats {
  nb_parties: number;
  nb_gagnees: number;
  total_mise: number;
  resultat_net: number;
  taux_reussite: number | null;
  net_blackjack: number;
  net_roulette: number;
  net_machine: number;
}

interface Mouvement {
  id: number;
  type: string;
  montant: number;
  solde_apres: number;
  libelle: string | null;
  cree_le: string;
}

interface PartieJouee {
  partie_id: number;
  jeu: string;
  mise: number;
  gain: number;
  net: number;
  resultat: string;
  jouee_le: string;
}

type Parrainage = { niveau: number; nb: number; pseudos: string[] }[];

const TYPES: Record<string, string> = {
  depot: 'Dépôt',
  retrait: 'Retrait',
  mise: 'Mise',
  gain: 'Gain',
  bonus: 'Bonus',
  remboursement: 'Remboursement',
  transfert_envoye: 'Envoi',
  transfert_recu: 'Réception',
};

const RESULTATS: Record<string, string> = {
  gagne: 'Gagné', perdu: 'Perdu', egalite: 'Égalité', blackjack: 'Blackjack',
};

const date = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
const heure = (s: string) =>
  new Date(s).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const ONGLETS = [
  { id: 'portefeuille', libelle: 'Portefeuille' },
  { id: 'historique', libelle: 'Historique' },
  { id: 'stats', libelle: 'Mes stats' },
  { id: 'responsable', libelle: 'Jeu responsable' },
  { id: 'compte', libelle: 'Mon compte' },
] as const;
type Onglet = (typeof ONGLETS)[number]['id'];

export function Profil() {
  const [onglet, setOnglet] = useState<Onglet>('portefeuille');
  const [compte, setCompte] = useState<Compte | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [mouvements, setMouvements] = useState<Mouvement[]>([]);
  const [parties, setParties] = useState<PartieJouee[]>([]);
  const [parrainage, setParrainage] = useState<Parrainage | null>(null);
  const { poser } = useSolde();
  const toast = useToast();
  const naviguer = useNavigate();
  const onglets = useRef<(HTMLButtonElement | null)[]>([]);

  const charger = useCallback(async () => {
    const [c, s, m, p, pa] = await Promise.allSettled([
      api.get<Compte>('/moi'),
      api.get<Stats | null>('/moi/statistiques'),
      api.get<Mouvement[]>('/moi/transactions?limite=60'),
      api.get<PartieJouee[]>('/moi/parties?limite=30'),
      api.get<Parrainage>('/moi/parrainage'),
    ]);
    if (c.status === 'fulfilled') { setCompte(c.value); poser(Number(c.value.solde)); }
    if (s.status === 'fulfilled' && s.value) setStats(s.value);
    if (m.status === 'fulfilled') setMouvements(m.value);
    if (p.status === 'fulfilled') setParties(p.value);
    if (pa.status === 'fulfilled') setParrainage(pa.value);
  }, [poser]);

  useEffect(() => { void charger(); }, [charger]);

  /** Une operation, puis un rechargement : le front n'invente jamais un solde. */
  async function operer(chemin: string, corps: unknown, succes: string): Promise<boolean> {
    try {
      await api.post(chemin, corps);
      toast(succes);
      await charger();
      return true;
    } catch (err) {
      toast((err as Error).message, 'erreur');
      return false;
    }
  }

  // Navigation au clavier entre les onglets (fleches gauche / droite).
  function clavier(e: KeyboardEvent, i: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const j = (i + (e.key === 'ArrowRight' ? 1 : ONGLETS.length - 1)) % ONGLETS.length;
    setOnglet(ONGLETS[j]!.id);
    onglets.current[j]?.focus();
  }

  if (!compte) return <p className="discret">Chargement de votre compte…</p>;

  const exclu = compte.exclu_jusqu_au && new Date(compte.exclu_jusqu_au) > new Date();

  return (
    <>
      <header className="profil-tete">
        <div>
          <h1>{compte.pseudo}</h1>
          <p className="chapeau">Membre depuis le {date(compte.inscrit_le)}</p>
        </div>
        <div className="profil-tete__solde">
          <span className="montant">{jetons(compte.solde)}</span>
          <span className="discret">jetons disponibles</span>
        </div>
      </header>

      {exclu && (
        <p className="alerte" role="status">
          Vous vous êtes exclu du jeu jusqu'au {date(compte.exclu_jusqu_au)}. Les tables vous
          sont fermées d'ici là.
        </p>
      )}

      <div className="onglets" role="tablist" aria-label="Sections du profil">
        {ONGLETS.map((o, i) => (
          <button
            key={o.id}
            ref={(el) => { onglets.current[i] = el; }}
            role="tab"
            id={`onglet-${o.id}`}
            aria-selected={onglet === o.id}
            aria-controls={`panneau-${o.id}`}
            tabIndex={onglet === o.id ? 0 : -1}
            className="onglet"
            onClick={() => setOnglet(o.id)}
            onKeyDown={(e) => clavier(e, i)}
          >
            {o.libelle}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panneau-${onglet}`} aria-labelledby={`onglet-${onglet}`}>
        {onglet === 'portefeuille' && <Portefeuille operer={operer} />}
        {onglet === 'historique' && <Historiques stats={stats} parties={parties} mouvements={mouvements} />}
        {onglet === 'stats' && <MesStats />}
        {onglet === 'responsable' && <Responsable compte={compte} operer={operer} />}
        {onglet === 'compte' && (
          <MonCompte
            compte={compte}
            parrainage={parrainage}
            recharger={charger}
            deconnecter={() => {
              session.fermer();
              poser(0);
              toast('Vous êtes déconnecté.');
              naviguer('/');
            }}
          />
        )}
      </div>
    </>
  );
}

type Operer = (chemin: string, corps: unknown, succes: string) => Promise<boolean>;

/* ---------------------------------------------------------------------------
   Portefeuille : deposer, retirer, envoyer
   ------------------------------------------------------------------------ */
function Portefeuille({ operer }: { operer: Operer }) {
  const [montant, setMontant] = useState(100);
  const [vers, setVers] = useState('');
  const [aEnvoyer, setAEnvoyer] = useState(50);

  async function envoyer(e: FormEvent) {
    e.preventDefault();
    if (await operer('/moi/transfert', { vers: vers.trim(), montant: aEnvoyer }, `${jetons(aEnvoyer)} jetons envoyés à ${vers.trim()}.`)) {
      setVers('');
    }
  }

  return (
    <>
      <div className="colonnes">
        <section aria-labelledby="caisse-titre">
          <h2 id="caisse-titre" style={{ marginBottom: '1rem' }}>Déposer ou retirer</h2>
          <div className="formulaire-ligne">
            <div className="champ">
              <label htmlFor="montant">Montant</label>
              <input id="montant" type="number" min={1} max={10000} value={montant}
                     onChange={(e) => setMontant(Number(e.target.value))} aria-describedby="montant-aide" />
            </div>
            <button className="bouton bouton--principal"
                    onClick={() => void operer('/moi/depot', { montant }, `${jetons(montant)} jetons déposés.`)}>
              Déposer
            </button>
            <button className="bouton"
                    onClick={() => void operer('/moi/retrait', { montant }, `${jetons(montant)} jetons retirés.`)}>
              Retirer
            </button>
          </div>
          <p id="montant-aide" className="champ__aide" style={{ marginTop: '0.5rem' }}>
            10 000 jetons au plus par dépôt. Un retrait est refusé tant qu'une main de blackjack est en cours.
          </p>
        </section>

        <section aria-labelledby="envoi-titre">
          <h2 id="envoi-titre" style={{ marginBottom: '1rem' }}>Envoyer des jetons</h2>
          <form className="formulaire-ligne" onSubmit={envoyer}>
            <div className="champ">
              <label htmlFor="vers">À qui</label>
              <input id="vers" value={vers} onChange={(e) => setVers(e.target.value)} placeholder="Pseudo" required />
            </div>
            <div className="champ" style={{ flexBasis: 110 }}>
              <label htmlFor="aenvoyer">Combien</label>
              <input id="aenvoyer" type="number" min={1} max={5000} value={aEnvoyer}
                     onChange={(e) => setAEnvoyer(Number(e.target.value))} />
            </div>
            <button className="bouton bouton--principal" type="submit">Envoyer</button>
          </form>
          <p className="champ__aide" style={{ marginTop: '0.5rem' }}>5 000 jetons au plus par envoi.</p>
        </section>
      </div>

      <SousLeCapot>
        <p>
          Un envoi débite un compte et en crédite un autre : deux écritures, mais une seule
          transaction, dans la procédure <code>transferer_jetons()</code>. Si le débit échoue,
          le crédit n'a jamais lieu. Les deux comptes sont verrouillés dans l'ordre de leurs
          identifiants, pour que deux envois croisés ne puissent pas se bloquer mutuellement.
        </p>
        <p>
          Chaque envoi est aussi enregistré dans la table <code>transferts</code>, qui forme
          un graphe « qui a payé qui ». Le back-office y repère les jetons qui tournent en
          boucle entre plusieurs joueurs, avec une requête <code>WITH RECURSIVE … CYCLE</code>.
        </p>
      </SousLeCapot>
    </>
  );
}

/* ---------------------------------------------------------------------------
   Historique : statistiques, parties, grand livre
   ------------------------------------------------------------------------ */
function Historiques({ stats, parties, mouvements }: {
  stats: Stats | null; parties: PartieJouee[]; mouvements: Mouvement[];
}) {
  return (
    <>
      {stats && Number(stats.nb_parties) > 0 && (
        <dl className="chiffres">
          <div><dt>Parties jouées</dt><dd>{Number(stats.nb_parties).toLocaleString('fr-FR')}</dd></div>
          <div><dt>Parties gagnées</dt><dd>{Number(stats.taux_reussite ?? 0).toLocaleString('fr-FR')} %</dd></div>
          <div><dt>Total misé</dt><dd>{jetons(stats.total_mise)}</dd></div>
          <div>
            <dt>Résultat net</dt>
            <dd className={Number(stats.resultat_net) >= 0 ? 'gain' : 'perte'}>{signe(Number(stats.resultat_net))}</dd>
          </div>
        </dl>
      )}

      <section className="section" aria-labelledby="parties-titre">
        <h2 id="parties-titre">Dernières parties</h2>
        {parties.length === 0 ? (
          <p className="vide">Vous n'avez encore joué aucune partie. Les tables sont dans le salon.</p>
        ) : (
          <div className="tableau-conteneur">
            <table className="donnees">
              <thead>
                <tr><th>Quand</th><th>Jeu</th><th>Issue</th><th className="nombre">Mise</th><th className="nombre">Résultat</th></tr>
              </thead>
              <tbody>
                {parties.map((p) => (
                  <tr key={p.partie_id}>
                    <td className="discret">{heure(p.jouee_le)}</td>
                    <td>{p.jeu === 'Machine a sous' ? 'Machine à sous' : p.jeu}</td>
                    <td><span className="etiquette">{RESULTATS[p.resultat] ?? p.resultat}</span></td>
                    <td className="nombre">{jetons(p.mise)}</td>
                    <td className={`nombre ${Number(p.net) > 0 ? 'gain' : Number(p.net) < 0 ? 'perte' : ''}`}>{signe(Number(p.net))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="livre-titre">
        <h2 id="livre-titre">Tous les mouvements</h2>
        <div className="tableau-conteneur">
          <table className="donnees">
            <thead>
              <tr><th>Quand</th><th>Opération</th><th>Détail</th><th className="nombre">Montant</th><th className="nombre">Solde</th></tr>
            </thead>
            <tbody>
              {mouvements.map((m) => (
                <tr key={m.id}>
                  <td className="discret">{heure(m.cree_le)}</td>
                  <td><span className="etiquette">{TYPES[m.type] ?? m.type}</span></td>
                  <td className="discret">{m.libelle ?? ''}</td>
                  <td className={`nombre ${Number(m.montant) >= 0 ? 'gain' : 'perte'}`}>{signe(Number(m.montant))}</td>
                  <td className="nombre">{jetons(m.solde_apres)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <SousLeCapot>
        <p>
          Les quatre chiffres du haut viennent d'un seul parcours de la table des parties,
          grâce à <code>FILTER</code> dans la vue <code>v_stats_joueur</code>.
        </p>
        <p>
          La requête des mouvements ne contient <strong>aucun</strong> filtre sur le joueur.
          C'est la politique de sécurité au niveau ligne <code>transactions_du_joueur</code> qui
          ne laisse passer que les vôtres. Un bug dans l'API ne pourrait donc pas afficher les
          mouvements d'un autre joueur. Ces mouvements ne peuvent ni être modifiés ni être
          effacés : une correction s'écrit toujours comme un mouvement inverse.
        </p>
      </SousLeCapot>
    </>
  );
}

/* ---------------------------------------------------------------------------
   Jeu responsable : chaque decision est confirmee, car la base la rend
   irreversible (une exclusion ne se raccourcit pas, une limite ne remonte pas).
   ------------------------------------------------------------------------ */
function Responsable({ compte, operer }: { compte: Compte; operer: Operer }) {
  const [jours, setJours] = useState<number | null>(null);
  const [limite, setLimite] = useState(compte.limite_mise ? Number(compte.limite_mise) : 50);

  const fin = jours ? new Date(Date.now() + jours * 86400000) : null;

  return (
    <>
      <div className="colonnes">
        <section aria-labelledby="pause-titre">
          <h2 id="pause-titre" style={{ marginBottom: '0.5rem' }}>Faire une pause</h2>
          <p className="discret" style={{ marginTop: 0 }}>
            Pendant la pause, aucune table n'accepte vos mises. Une pause en cours peut être
            prolongée, jamais raccourcie.
          </p>
          <div className="choix" role="group" aria-label="Durée de la pause">
            {[1, 7, 30, 90].map((j) => (
              <button key={j} className="bouton" aria-pressed={jours === j} onClick={() => setJours(j)}>
                {j === 1 ? '24 heures' : `${j} jours`}
              </button>
            ))}
          </div>
          {fin && (
            <div style={{ marginTop: '1rem' }}>
              <p>Vous ne pourrez plus miser avant le <strong>{date(fin.toISOString())}</strong>.</p>
              <div className="choix">
                <button
                  className="bouton bouton--principal"
                  onClick={async () => {
                    if (await operer('/moi/exclusion', { jours }, `Pause enregistrée jusqu'au ${date(fin.toISOString())}.`)) setJours(null);
                  }}
                >
                  Confirmer la pause
                </button>
                <button className="bouton bouton--discret" onClick={() => setJours(null)}>Annuler</button>
              </div>
            </div>
          )}
        </section>

        <section aria-labelledby="limite-titre">
          <h2 id="limite-titre" style={{ marginBottom: '0.5rem' }}>Plafonner mes mises</h2>
          <p className="discret" style={{ marginTop: 0 }}>
            {compte.limite_mise
              ? `Votre plafond actuel est de ${jetons(compte.limite_mise)} jetons par mise. Il ne peut que baisser.`
              : 'Aucun plafond pour l\'instant. Une fois fixé, il ne pourra que baisser.'}
          </p>
          <div className="formulaire-ligne">
            <div className="champ">
              <label htmlFor="limite">Mise maximale</label>
              <input id="limite" type="number" min={1} value={limite} onChange={(e) => setLimite(Number(e.target.value))} />
            </div>
            <button
              className="bouton bouton--principal"
              onClick={() => void operer('/moi/limite', { limite }, `Plafond fixé à ${jetons(limite)} jetons par mise.`)}
            >
              Appliquer le plafond
            </button>
          </div>
        </section>
      </div>

      <SousLeCapot>
        <p>
          Ces deux règles sont écrites dans la base, dans <code>definir_exclusion()</code> et{' '}
          <code>definir_limite()</code>. Aucun client ne peut les contourner, pas même pgAdmin :
          le déclencheur <code>transactions_verifier_mise</code> refuse toute mise d'un joueur
          en pause, même écrite directement dans la table des mouvements.
        </p>
      </SousLeCapot>
    </>
  );
}

/* ---------------------------------------------------------------------------
   Mon compte : coordonnees, mot de passe, parrainage, deconnexion
   ------------------------------------------------------------------------ */
function MonCompte({ compte, parrainage, recharger, deconnecter }: {
  compte: Compte;
  parrainage: Parrainage | null;
  recharger: () => Promise<void>;
  deconnecter: () => void;
}) {
  const toast = useToast();
  const [pseudo, setPseudo] = useState(compte.pseudo);
  const [email, setEmail] = useState(compte.email);
  const [ancien, setAncien] = useState('');
  const [nouveau, setNouveau] = useState('');

  async function enregistrer(e: FormEvent) {
    e.preventDefault();
    try {
      await api.patch('/moi', { pseudo, email });
      toast('Coordonnées enregistrées.');
      await recharger();
    } catch (err) {
      toast((err as Error).message, 'erreur');
    }
  }

  async function changerMotDePasse(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post('/moi/mot-de-passe', { ancien, nouveau });
      toast('Mot de passe changé.');
      setAncien('');
      setNouveau('');
    } catch (err) {
      toast((err as Error).message, 'erreur');
    }
  }

  const filleuls = parrainage ?? [];

  return (
    <>
      <div className="colonnes">
        <form onSubmit={enregistrer} aria-labelledby="coord-titre">
          <h2 id="coord-titre" style={{ marginBottom: '1rem' }}>Coordonnées</h2>
          <div className="champ">
            <label htmlFor="c-pseudo">Pseudo</label>
            <input id="c-pseudo" value={pseudo} onChange={(e) => setPseudo(e.target.value)} minLength={3} maxLength={24} />
          </div>
          <div className="champ">
            <label htmlFor="c-email">Email</label>
            <input id="c-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button className="bouton bouton--principal" type="submit"
                  disabled={pseudo === compte.pseudo && email === compte.email}>
            Enregistrer les coordonnées
          </button>
        </form>

        <form onSubmit={changerMotDePasse} aria-labelledby="mdp-titre">
          <h2 id="mdp-titre" style={{ marginBottom: '1rem' }}>Mot de passe</h2>
          <div className="champ">
            <label htmlFor="ancien">Mot de passe actuel</label>
            <input id="ancien" type="password" autoComplete="current-password" value={ancien}
                   onChange={(e) => setAncien(e.target.value)} required />
          </div>
          <div className="champ">
            <label htmlFor="nouveau">Nouveau mot de passe</label>
            <input id="nouveau" type="password" autoComplete="new-password" minLength={8} value={nouveau}
                   onChange={(e) => setNouveau(e.target.value)} required />
            <span className="champ__aide">8 caractères minimum.</span>
          </div>
          <button className="bouton bouton--principal" type="submit">Changer le mot de passe</button>
        </form>
      </div>

      <section className="section" aria-labelledby="parrain-titre">
        <h2 id="parrain-titre">Parrainage</h2>
        <dl className="fiche" style={{ marginBottom: '1rem' }}>
          <dt>Parrainé par</dt>
          <dd>{compte.parraine_par ?? 'Personne'}</dd>
          <dt>Votre code</dt>
          <dd>{compte.pseudo} <span className="discret">— chaque inscription avec ce code vous rapporte 50 jetons</span></dd>
        </dl>
        {filleuls.length > 0 ? (
          <div className="tableau-conteneur">
            <table className="donnees">
              <thead><tr><th>Génération</th><th className="nombre">Filleuls</th><th>Qui</th></tr></thead>
              <tbody>
                {filleuls.map((n) => (
                  <tr key={n.niveau}>
                    <td>{n.niveau === 1 ? 'Vos filleuls directs' : `Leurs filleuls, rang ${n.niveau}`}</td>
                    <td className="nombre">{n.nb}</td>
                    <td className="discret">{n.pseudos.slice(0, 5).join(', ')}{n.pseudos.length > 5 ? ` et ${n.pseudos.length - 5} autres` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="discret">Personne ne s'est encore inscrit avec votre code.</p>
        )}
      </section>

      <section className="section">
        <button className="bouton" onClick={deconnecter}>Se déconnecter</button>
      </section>

      <SousLeCapot>
        <p>
          L'API n'a pas le droit de lire la colonne <code>email</code> : elle passe par{' '}
          <code>mon_compte()</code>, seule fonction autorisée à la renvoyer, et seulement pour
          le joueur connecté. Le mot de passe est vérifié et haché par PostgreSQL lui-même
          (bcrypt, via pgcrypto) : il ne ressort jamais de la base.
        </p>
        <p>
          L'arbre de parrainage est parcouru par un <code>WITH RECURSIVE</code>. Un déclencheur
          interdit les boucles (A parraine B qui parraine A), sans quoi la récursion ne
          s'arrêterait jamais.
        </p>
      </SousLeCapot>
    </>
  );
}
