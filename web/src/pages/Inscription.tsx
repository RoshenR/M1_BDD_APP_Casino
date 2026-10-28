import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, session, type Joueur } from '../lib/api';
import { useSolde } from '../lib/solde';
import { useToast } from '../lib/toast';
import { Jeton, Piles } from '../components/Jetons';

export function Inscription() {
  const [champs, setChamps] = useState({
    pseudo: '',
    email: '',
    motDePasse: '',
    dateNaissance: '',
    codeParrain: '',
  });
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const naviguer = useNavigate();
  const { rafraichir } = useSolde();
  const toast = useToast();

  const maj = (nom: keyof typeof champs) => (e: { target: { value: string } }) =>
    setChamps((c) => ({ ...c, [nom]: e.target.value }));

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    setErreur('');
    setEnvoi(true);
    try {
      const r = await api.post<{ token: string; refresh: string; joueur: Joueur }>(
        '/auth/inscription',
        { ...champs, codeParrain: champs.codeParrain.trim() || undefined },
      );
      session.ouvrir(r.token, r.refresh, r.joueur);
      await rafraichir();
      toast('Compte créé : 100 jetons vous attendent.');
      naviguer('/');
    } catch (err) {
      // Le message vient tel quel de la base : « Inscription reservee aux
      // majeurs », « Pseudo ou email deja utilise »...
      setErreur((err as Error).message);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="accueil">
      <div className="accueil__form">
        <h1>Créer un compte</h1>
        <p className="chapeau">Réservé aux personnes majeures.</p>

        <form onSubmit={soumettre}>
          {erreur && <p className="alerte" role="alert">{erreur}</p>}

          <div className="champ">
            <label htmlFor="pseudo">Pseudo</label>
            <input id="pseudo" autoComplete="username" value={champs.pseudo} onChange={maj('pseudo')}
                   minLength={3} maxLength={24} pattern="[A-Za-z0-9_\-]{3,24}" required
                   aria-describedby="pseudo-aide" />
            <span id="pseudo-aide" className="champ__aide">3 à 24 caractères : lettres, chiffres, tiret ou souligné.</span>
          </div>

          <div className="champ">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="email" value={champs.email} onChange={maj('email')} required />
          </div>

          <div className="champ">
            <label htmlFor="mdp">Mot de passe</label>
            <input id="mdp" type="password" autoComplete="new-password" value={champs.motDePasse}
                   onChange={maj('motDePasse')} minLength={8} required aria-describedby="mdp-aide" />
            <span id="mdp-aide" className="champ__aide">8 caractères minimum.</span>
          </div>

          <div className="champ">
            <label htmlFor="naissance">Date de naissance</label>
            <input id="naissance" type="date" value={champs.dateNaissance} onChange={maj('dateNaissance')} required />
          </div>

          <div className="champ">
            <label htmlFor="parrain">Parrain (facultatif)</label>
            <input id="parrain" value={champs.codeParrain} onChange={maj('codeParrain')}
                   placeholder="Pseudo de la personne qui vous a invité" maxLength={24}
                   aria-describedby="parrain-aide" />
            <span id="parrain-aide" className="champ__aide">Votre parrain reçoit 50 jetons.</span>
          </div>

          <button className="bouton bouton--principal bouton--grand" type="submit" disabled={envoi}>
            {envoi ? 'Création…' : 'Créer mon compte'}
          </button>
        </form>

        <p className="accueil__bas">
          Déjà inscrit ? <Link to="/connexion">Connectez-vous</Link>
        </p>
      </div>

      <section className="demo" aria-label="Ce que vous recevez">
        <div className="table" style={{ display: 'grid', justifyItems: 'center', gap: '1rem', padding: '2.5rem 1.5rem' }}>
          <Piles montant={100} />
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Jeton valeur={25} /><Jeton valeur={25} /><Jeton valeur={25} /><Jeton valeur={25} />
          </div>
          <p style={{ textAlign: 'center', margin: 0, maxWidth: '32ch' }}>
            100 jetons de bienvenue sont crédités dès l'ouverture du compte, dans la même
            opération que sa création.
          </p>
        </div>
      </section>
    </div>
  );
}
