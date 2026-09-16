import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, session, type Joueur } from '../lib/api';
import { useSolde } from '../lib/solde';

interface Reponse {
  token: string;
  refresh: string;
  joueur: Joueur;
}

export function Connexion() {
  const [email, setEmail] = useState('alice@casino.test');
  const [motDePasse, setMotDePasse] = useState('motdepasse');
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const naviguer = useNavigate();
  const { rafraichir } = useSolde();

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    setErreur('');
    setEnvoi(true);
    try {
      // Le mot de passe part en clair vers l'API (HTTPS en production), qui le
      // transmet a authentifier(). La comparaison bcrypt se fait DANS PostgreSQL :
      // ni l'API ni le front ne voient jamais le hash.
      const r = await api.post<Reponse>('/auth/connexion', { email, motDePasse });
      session.ouvrir(r.token, r.refresh, r.joueur);
      await rafraichir();
      naviguer('/');
    } catch (err) {
      setErreur((err as Error).message);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="centre">
      <form className="carte etroit" onSubmit={soumettre}>
        <h1>Connexion</h1>
        <p className="sous-titre">Comptes de demonstration : alice, bob, carol, dave, admin</p>

        {erreur && <div className="erreur">{erreur}</div>}

        <div className="champ">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>

        <div className="champ">
          <label htmlFor="mdp">Mot de passe</label>
          <input id="mdp" type="password" value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} required />
        </div>

        <button className="principal" type="submit" disabled={envoi} style={{ width: '100%' }}>
          {envoi ? 'Verification...' : 'Se connecter'}
        </button>

        <p className="discret" style={{ marginTop: '1rem', textAlign: 'center' }}>
          Pas encore de compte ? <Link to="/inscription">Inscrivez-vous</Link>
        </p>
      </form>
    </div>
  );
}
