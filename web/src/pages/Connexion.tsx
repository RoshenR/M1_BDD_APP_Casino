import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, session, type Joueur } from '../lib/api';
import { useSolde } from '../lib/solde';
import { useToast } from '../lib/toast';
import { Jeton } from '../components/Jetons';

interface Reponse {
  token: string;
  refresh: string;
  joueur: Joueur;
}

const DEMO = [
  { pseudo: 'alice', jeton: 25, role: 'Joueuse' },
  { pseudo: 'bob', jeton: 5, role: 'Joueur' },
  { pseudo: 'carol', jeton: 100, role: 'Joueuse' },
  { pseudo: 'dave', jeton: 1, role: 'Joueur' },
  { pseudo: 'admin', jeton: 500, role: 'Administrateur' },
];

export function Connexion() {
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const naviguer = useNavigate();
  const lieu = useLocation();
  const { rafraichir } = useSolde();
  const toast = useToast();

  async function seConnecter(mail: string, mdp: string) {
    setErreur('');
    setEnvoi(true);
    try {
      const r = await api.post<Reponse>('/auth/connexion', { email: mail, motDePasse: mdp });
      session.ouvrir(r.token, r.refresh, r.joueur);
      await rafraichir();
      toast(`Bienvenue, ${r.joueur.pseudo}.`);
      const retour = (lieu.state as { retour?: string } | null)?.retour;
      naviguer(retour ?? '/');
    } catch (err) {
      setErreur((err as Error).message);
    } finally {
      setEnvoi(false);
    }
  }

  function soumettre(e: FormEvent) {
    e.preventDefault();
    void seConnecter(email, motDePasse);
  }

  return (
    <div className="accueil">
      <div className="accueil__form">
        <h1>Se connecter</h1>
        <p className="chapeau">Retrouvez vos jetons là où vous les avez laissés.</p>

        <form onSubmit={soumettre}>
          {erreur && <p className="alerte" role="alert">{erreur}</p>}

          <div className="champ">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="email" value={email}
                   onChange={(e) => setEmail(e.target.value)} required />
          </div>

          <div className="champ">
            <label htmlFor="mdp">Mot de passe</label>
            <input id="mdp" type="password" autoComplete="current-password" value={motDePasse}
                   onChange={(e) => setMotDePasse(e.target.value)} required />
          </div>

          <button className="bouton bouton--principal bouton--grand" type="submit" disabled={envoi}>
            {envoi ? 'Vérification…' : 'Se connecter'}
          </button>
        </form>

        <p className="accueil__bas">
          Pas encore de compte ? <Link to="/inscription">Créez-en un</Link> et recevez 100 jetons.
        </p>
      </div>

      <section className="demo" aria-labelledby="demo-titre">
        <div className="table">
          <p id="demo-titre" className="table__titre" style={{ textAlign: 'left' }}>
            Comptes de démonstration
          </p>
          <div className="demo__liste">
            {DEMO.map((d) => (
              <button
                key={d.pseudo}
                type="button"
                className="demo__compte"
                disabled={envoi}
                onClick={() => void seConnecter(`${d.pseudo}@casino.test`, 'motdepasse')}
              >
                <Jeton valeur={d.jeton} taille="s" />
                <span>
                  <strong>{d.pseudo}</strong>
                  <small>{d.role}</small>
                </span>
              </button>
            ))}
          </div>
          <p>Un clic suffit pour entrer. Tous partagent le mot de passe <code>motdepasse</code>.</p>
        </div>
      </section>
    </div>
  );
}
