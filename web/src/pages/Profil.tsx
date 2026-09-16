import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { jetons, useSolde } from '../lib/solde';

interface Compte {
  joueur_id: number;
  pseudo: string;
  email: string;
  solde: number;
  statut: string;
  role: string;
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

interface Parrainage {
  postgres: { niveau: number; nb: number; pseudos: string[] }[];
}

const dateFr = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

export function Profil() {
  const [compte, setCompte] = useState<Compte | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [mouvements, setMouvements] = useState<Mouvement[]>([]);
  const [parrainage, setParrainage] = useState<Parrainage | null>(null);
  const [montant, setMontant] = useState(100);
  const [destinataire, setDestinataire] = useState('bob');
  const [montantTransfert, setMontantTransfert] = useState(50);
  const [message, setMessage] = useState('');
  const [erreur, setErreur] = useState('');
  const { poser } = useSolde();

  async function tout() {
    const [c, s, m, p] = await Promise.allSettled([
      api.get<Compte>('/moi'),
      api.get<Stats | null>('/moi/statistiques'),
      api.get<Mouvement[]>('/moi/transactions?limite=40'),
      api.get<Parrainage>('/moi/parrainage'),
    ]);
    if (c.status === 'fulfilled') { setCompte(c.value); poser(Number(c.value.solde)); }
    if (s.status === 'fulfilled' && s.value) setStats(s.value);
    if (m.status === 'fulfilled') setMouvements(m.value);
    if (p.status === 'fulfilled') setParrainage(p.value);
  }

  useEffect(() => { void tout(); }, []);

  async function operation(chemin: string, corps: unknown, succes: string) {
    setErreur(''); setMessage('');
    try {
      await api.post(chemin, corps);
      setMessage(succes);
      await tout();
    } catch (err) {
      setErreur((err as Error).message);
    }
  }

  if (!compte) return <p className="discret">Chargement...</p>;

  return (
    <>
      <h1>Profil</h1>
      <p className="sous-titre">
        Ces donnees sont servies par <code className="mono">mon_compte()</code>, la seule
        fonction autorisee a exposer un email — et seulement le votre.
      </p>

      {erreur && <div className="erreur">{erreur}</div>}
      {message && <div className="succes">{message}</div>}

      <div className="grille">
        <div className="carte">
          <h2 style={{ marginTop: 0 }}>Compte</h2>
          <table>
            <tbody>
              <tr><th>Pseudo</th><td>{compte.pseudo}</td></tr>
              <tr><th>Email</th><td>{compte.email}</td></tr>
              <tr><th>Statut</th><td><span className="pastille">{compte.statut}</span></td></tr>
              <tr><th>Inscrit le</th><td>{dateFr(compte.inscrit_le)}</td></tr>
              <tr><th>Parraine par</th><td>{compte.parraine_par ?? '—'}</td></tr>
              <tr><th>Solde</th><td><strong>{jetons(compte.solde)} jetons</strong></td></tr>
            </tbody>
          </table>
        </div>

        <div className="carte">
          <h2 style={{ marginTop: 0 }}>Portefeuille</h2>
          <div className="champ">
            <label htmlFor="montant">Montant</label>
            <input id="montant" type="number" min={1} max={10000} value={montant}
                   onChange={(e) => setMontant(Number(e.target.value))} />
          </div>
          <div className="boutons" style={{ justifyContent: 'flex-start' }}>
            <button className="principal"
                    onClick={() => void operation('/moi/depot', { montant }, 'Depot effectue.')}>
              Deposer
            </button>
            <button onClick={() => void operation('/moi/retrait', { montant }, 'Retrait effectue.')}>
              Retirer
            </button>
          </div>
          <p className="notice">
            Le depot est plafonne a 10 000 jetons et le retrait refuse si une main est
            en cours. Ces deux regles sont dans <code className="mono">deposer()</code> et
            <code className="mono"> retirer()</code>, pas dans ce formulaire.
          </p>
        </div>
      </div>

      <h2>Transferer des jetons</h2>
      <div className="carte">
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ width: 200 }}>
            <label htmlFor="dest">Pseudo du destinataire</label>
            <input id="dest" value={destinataire} onChange={(e) => setDestinataire(e.target.value)} />
          </div>
          <div style={{ width: 160 }}>
            <label htmlFor="mtTransfert">Montant</label>
            <input id="mtTransfert" type="number" min={1} max={5000} value={montantTransfert}
                   onChange={(e) => setMontantTransfert(Number(e.target.value))} />
          </div>
          <button onClick={() => void operation(
            '/moi/transfert',
            { vers: destinataire, montant: montantTransfert },
            `${montantTransfert} jetons envoyes a ${destinataire}.`)}>
            Envoyer
          </button>
        </div>
        <p className="notice">
          Le cas d&apos;ecole de l&apos;atomicite : debiter un compte et crediter
          l&apos;autre sont <strong>deux ecritures</strong> mais <strong>une seule
          transaction</strong>. Si le debit echoue, le credit n&apos;a jamais lieu —
          aucun jeton ne peut apparaitre ni disparaitre. Cote API, c&apos;est un seul
          <code className="mono"> CALL transferer_jetons(...)</code>.
        </p>
        <p className="notice">
          Ces transferts alimentent le graphe Neo4j. Trois joueurs qui se renvoient
          les memes jetons en boucle forment un <strong>cycle</strong>, que le
          back-office detecte en une requete Cypher.
        </p>
      </div>

      {stats && (
        <>
          <h2>Statistiques</h2>
          <div className="carte">
            <table>
              <tbody>
                <tr><th>Parties jouees</th><td className="num">{Number(stats.nb_parties).toLocaleString('fr-FR')}</td></tr>
                <tr><th>Parties gagnees</th><td className="num">{Number(stats.nb_gagnees).toLocaleString('fr-FR')}</td></tr>
                <tr><th>Taux de reussite</th><td className="num">{stats.taux_reussite ?? '—'} %</td></tr>
                <tr><th>Total mise</th><td className="num">{jetons(stats.total_mise)}</td></tr>
                <tr>
                  <th>Resultat net</th>
                  <td className={`num ${Number(stats.resultat_net) >= 0 ? 'gain' : 'perte'}`}>
                    {jetons(stats.resultat_net)}
                  </td>
                </tr>
                <tr><th>dont Blackjack</th><td className="num">{jetons(stats.net_blackjack)}</td></tr>
                <tr><th>dont Roulette</th><td className="num">{jetons(stats.net_roulette)}</td></tr>
                <tr><th>dont Machine</th><td className="num">{jetons(stats.net_machine)}</td></tr>
              </tbody>
            </table>
            <p className="notice">
              Ces huit chiffres viennent d&apos;<strong>un seul parcours</strong> de la table
              parties, grace a <code className="mono">FILTER</code> dans la vue
              <code className="mono"> v_stats_joueur</code>. Sans lui, il faudrait huit
              sous-requetes.
            </p>
          </div>
        </>
      )}

      <h2>Jeu responsable</h2>
      <div className="carte">
        <p className="discret" style={{ marginTop: 0 }}>
          Auto-exclusion actuelle : <strong>{dateFr(compte.exclu_jusqu_au)}</strong> —
          limite de mise : <strong>{compte.limite_mise ? `${jetons(compte.limite_mise)} jetons` : 'aucune'}</strong>
        </p>
        <div className="boutons" style={{ justifyContent: 'flex-start' }}>
          {[1, 7, 30].map((j) => (
            <button key={j}
                    onClick={() => void operation('/moi/exclusion', { jours: j }, `Auto-exclusion de ${j} jour(s) enregistree.`)}>
              M&apos;exclure {j} jour{j > 1 ? 's' : ''}
            </button>
          ))}
          <button onClick={() => void operation('/moi/limite', { limite: 50 }, 'Limite de mise fixee a 50 jetons.')}>
            Limiter mes mises a 50
          </button>
        </div>
        <p className="notice">
          Une auto-exclusion ne peut qu&apos;etre <strong>allongee</strong>, une limite ne peut
          que <strong>baisser</strong>. Ces regles sont dans la base : aucun client, pas meme
          pgAdmin, ne peut les contourner. Et le trigger
          <code className="mono"> transactions_verifier_mise</code> refuse la mise meme si
          l&apos;on ecrivait directement dans le grand livre.
        </p>
      </div>

      {parrainage && parrainage.postgres.length > 0 && (
        <>
          <h2>Parrainage</h2>
          <div className="carte">
            <table>
              <thead><tr><th>Niveau</th><th className="num">Filleuls</th><th>Qui</th></tr></thead>
              <tbody>
                {parrainage.postgres.map((n) => (
                  <tr key={n.niveau}>
                    <td>{n.niveau}</td>
                    <td className="num">{n.nb}</td>
                    <td className="discret">{n.pseudos.slice(0, 6).join(', ')}{n.pseudos.length > 6 ? '...' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="notice">
              Calcule par un <code className="mono">WITH RECURSIVE</code> cote PostgreSQL.
              L&apos;API interroge aussi Neo4j avec la meme question en Cypher
              (<code className="mono">MATCH (moi)-[:PARRAINE*1..5]-&gt;(f)</code>) pour comparer
              les deux approches.
            </p>
          </div>
        </>
      )}

      <h2>Grand livre</h2>
      <div className="carte">
        <div className="tableau-defilant">
          <table>
            <thead>
              <tr><th>Date</th><th>Type</th><th>Libelle</th><th className="num">Montant</th><th className="num">Solde apres</th></tr>
            </thead>
            <tbody>
              {mouvements.map((m) => (
                <tr key={m.id}>
                  <td className="discret">{new Date(m.cree_le).toLocaleString('fr-FR')}</td>
                  <td><span className="pastille">{m.type}</span></td>
                  <td className="discret">{m.libelle ?? '—'}</td>
                  <td className={`num ${Number(m.montant) >= 0 ? 'gain' : 'perte'}`}>{jetons(m.montant)}</td>
                  <td className="num">{jetons(m.solde_apres)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="notice">
          La requete qui remplit ce tableau n&apos;a <strong>aucun</strong>{' '}
          <code className="mono">WHERE joueur_id = ...</code>. C&apos;est la politique RLS
          <code className="mono"> transactions_du_joueur</code> qui filtre, dans PostgreSQL.
          Un bug dans l&apos;API ne peut donc pas exposer le grand livre d&apos;un autre joueur.
        </p>
      </div>
    </>
  );
}
