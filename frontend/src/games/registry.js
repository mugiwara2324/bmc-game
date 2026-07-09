import BmcHome from "./blancMangerCoco/pages/Home";
import BmcLobby from "./blancMangerCoco/pages/Lobby";
import BmcGame from "./blancMangerCoco/pages/Game";
import BmcGameOver from "./blancMangerCoco/pages/GameOver";
import logoBmc from "./blancMangerCoco/assets/logo-BMC.png";
import logoSkyjo from "./skyjo/assets/skyjo_logo.png";
import logoUno from "./uno/assets/uno_logo.png";
import logoBizu from "./bizu/assets/bizu_logo.png";
import BizuHome from "./bizu/pages/Home";
import BizuLobby from "./bizu/pages/Lobby";
import BizuGame from "./bizu/pages/Game";
import BizuGameOver from "./bizu/pages/GameOver";
import SkyjoHome from "./skyjo/pages/Home";
import SkyjoLobby from "./skyjo/pages/Lobby";
import SkyjoGame from "./skyjo/pages/Game";
import SkyjoGameOver from "./skyjo/pages/GameOver";
import UnoHome from "./uno/pages/Home";
import UnoLobby from "./uno/pages/Lobby";
import UnoGame from "./uno/pages/Game";
import UnoGameOver from "./uno/pages/GameOver";

export const DEFAULT_GAME_ID = "noir-manger-coco";

export const games = [
  {
    id: DEFAULT_GAME_ID,
    title: "Blanc Manger Coco",
    subtitle: "La meilleur version du jeu Blanc Manger Coco",
    description:
      "Questions noires, reponses absurdes, un jeu pour rigoler entre amis.",
    badge: "Disponible",
    logo: logoBmc,
    screens: {
      Home: BmcHome,
      Lobby: BmcLobby,
      Game: BmcGame,
      GameOver: BmcGameOver,
    },
  },
  {
    id: "skyjo",
    title: "Skyjo",
    subtitle: "Révèle, échange, élimine tes colonnes",
    description:
      "Un jeu de cartes tactique où le plus petit score l'emporte avant les 100 points.",
    badge: "Disponible",
    logo: logoSkyjo,
    hubIcon: "12",
    hubIconClassName: "skyjo-hub-icon",
    screens: {
      Home: SkyjoHome,
      Lobby: SkyjoLobby,
      Game: SkyjoGame,
      GameOver: SkyjoGameOver,
    },
  },
  {
    id: "le-bizu",
    title: "Le BIZU",
    subtitle: "Retourne les cartes, applique les règles",
    description:
      "Un jeu de cartes pour boire avec 52 cartes, 2 jokers et une règle par carte.",
    badge: "Disponible",
    logo: logoBizu,
    hubIcon: "A★",
    hubIconClassName: "bizu-hub-icon",
    screens: {
      Home: BizuHome,
      Lobby: BizuLobby,
      Game: BizuGame,
      GameOver: BizuGameOver,
    },
  },
  {
    id: "uno",
    title: "UNO",
    subtitle: "Classique maintenant, Flip prepare",
    description:
      "Pose les bonnes couleurs, empile les +2 et vide ta main avant les autres.",
    badge: "Nouveau",
    logo: logoUno,
    hubIcon: "UNO",
    hubIconClassName: "uno-hub-icon",
    screens: {
      Home: UnoHome,
      Lobby: UnoLobby,
      Game: UnoGame,
      GameOver: UnoGameOver,
    },
  },
];

export function getGame(gameId) {
  return games.find((game) => game.id === gameId) || games[0];
}
