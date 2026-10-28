import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { session } from './lib/api';
import { FournisseurSolde, jetons, useSolde } from './lib/solde';
import { FournisseurToasts } from './lib/toast';
import { Jeton } from './components/Jetons';

import { Connexion } from './pages/Connexion';
import { Inscription } from './pages/Inscription';
import { Lobby } from './pages/Lobby';
import { Roulette } from './pages/Roulette';
import { Machine } from './pages/Machine';
import { Blackjack } from './pages/Blackjack';
import { Profil } from './pages/Profil';
import { Classement } from './pages/Classement';

function Protege({ children }: { children: ReactNode }) {
  const lieu = useLocation();
  return session.token()
    ? <>{children}</>
    : <Navigate to="/connexion" replace state={{ retour: lieu.pathname }} />;
}

function Entete() {
  const { solde, rafraichir } = useSolde();
  const joueur = session.joueur();
  const lieu = useLocation();

  // Le solde peut avoir bouge ailleurs (autre onglet, back-office) : on le relit
  // a chaque changement de page plutot que de le croire sur parole.
  useEffect(() => { void rafraichir(); }, [lieu.pathname, rafraichir]);

  return (
    <header className="entete">
      <div className="entete__interieur">
        <Link to="/" className="marque">
          <Jeton valeur={100} taille="xs" />
          Casino
        </Link>

        <nav className="nav" aria-label="Navigation principale">
          <NavLink to="/" end>Salon</NavLink>
          <NavLink to="/roulette">Roulette</NavLink>
          <NavLink to="/machine">Machine à sous</NavLink>
          <NavLink to="/blackjack">Blackjack</NavLink>
          <NavLink to="/classement">Classement</NavLink>
        </nav>

        {joueur ? (
          <Link to="/profil" className="caisse" title="Votre profil et votre portefeuille">
            <Jeton valeur={25} taille="s" />
            <span>
              <span className="montant">{jetons(solde)}</span>
              <span className="visuellement-cache"> jetons — profil de {joueur.pseudo}</span>
            </span>
          </Link>
        ) : (
          <Link to="/connexion" className="bouton bouton--principal">Se connecter</Link>
        )}
      </div>
    </header>
  );
}

export function App() {
  return (
    <FournisseurToasts>
      <FournisseurSolde>
        <Entete />
        <main>
          <Routes>
            <Route path="/" element={<Lobby />} />
            <Route path="/connexion" element={<Connexion />} />
            <Route path="/inscription" element={<Inscription />} />
            <Route path="/classement" element={<Classement />} />
            <Route path="/roulette" element={<Protege><Roulette /></Protege>} />
            <Route path="/machine" element={<Protege><Machine /></Protege>} />
            <Route path="/blackjack" element={<Protege><Blackjack /></Protege>} />
            <Route path="/profil" element={<Protege><Profil /></Protege>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </FournisseurSolde>
    </FournisseurToasts>
  );
}
