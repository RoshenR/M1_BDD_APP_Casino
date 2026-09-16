import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, session, type Joueur } from '../lib/api';
import { useSolde } from '../lib/solde';

export function Inscription() {
  const [champs, setChamps] = useState({
    pseudo: '',
    email: '',
    motDePasse: '',
    dateNaissance: '2000-01-01',
    codeParrain: '',
  });
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const naviguer = useNavigate();
  const { rafraichir } = useSolde();

  const maj = (nom: keyof typeof champs) => (e: { target: { value: string } }) =>
    setChamps((c) => ({ ...c, [nom]: e.target.value }));

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    setErreur('');
    setEnvoi(true);
    try {
      // Une seule instruction SQL derriere ce bouton : casino.inscrire().
      // Elle cree le compte, verifie la majorite (trigger), hache le mot de
      // passe, verse 100 jetons de bienvenue et 50 au parrain — le tout dans
      // une transaction. Si la moindre etape echoue, rien n'est ecrit.
      const r = await api.post<{ token: string; refresh: string; joueur: Joueur }>(
        '/auth/inscription',
        { ...champs, codeParrain: champs.codeParrain || undefined },
      );
      session.ouvrir(r.token, r.refresh, r.joueur);
      await rafraichir();
      naviguer('/');
    } catch (err) {
      // Le message vient tel quel du RAISE EXCEPTION PL/pgSQL :
      // « Inscription reservee aux majeurs », « Pseudo ou email deja utilise »...
      setErreur((err as Error).message);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="centre">
      <form className="carte etroit" onSubmit={soumettre}>
        <h1>Inscription</h1>
        <p className="sous-titre">100 jetons offerts a l&apos;ouverture du compte.</p>

        {erreur && <div className="erreur">{erreur}</div>}

        <div className="champ">
          <label htmlFor="pseudo">Pseudo</label>
          <input id="pseudo" value={champs.pseudo} onChange={maj('pseudo')}
                 minLength={3} maxLength={24} required />
        </div>

        <div className="champ">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" value={champs.email} onChange={maj('email')} required />
        </div>

        <div className="champ">
          <label htmlFor="mdp">Mot de passe (8 caracteres minimum)</label>
          <input id="mdp" type="password" value={champs.motDePasse} onChange={maj('motDePasse')}
                 minLength={8} required />
        </div>

        <div className="champ">
          <label htmlFor="naissance">Date de naissance</label>
          <input id="naissance" type="date" value={champs.dateNaissance} onChange={maj('dateNaissance')} required />
        </div>

        <div className="champ">
          <label htmlFor="parrain">Pseudo du parrain (facultatif)</label>
          <input id="parrain" value={champs.codeParrain} onChange={maj('codeParrain')}
                 placeholder="alice" maxLength={24} />
        </div>

        <button className="principal" type="submit" disabled={envoi} style={{ width: '100%' }}>
          {envoi ? 'Creation...' : 'Creer mon compte'}
        </button>

        <p className="discret" style={{ marginTop: '1rem', textAlign: 'center' }}>
          Deja inscrit ? <Link to="/connexion">Connectez-vous</Link>
        </p>
      </form>
    </div>
  );
}
