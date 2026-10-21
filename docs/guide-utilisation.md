# Guide d?utilisation de FranceStudent IDE

## Prérequis

- Node.js 22 ou plus récent, et npm
- Un compte FranceStudent
- Pour l'application de bureau : les dépendances de développement (Electron, CodeMirror, xterm.js), installées par `npm install`

## Installation

Téléchargez le release correspondant à votre os


## Application de bureau (Windows et macOS)

Dans **Paramètres → Autorisations**, sélectionnez **Full accès** pour laisser l’agent exécuter les écritures, commandes et appels d’outils sans confirmation. Lis l’avertissement avant de l’activer. **Garder ce choix** conserve le réglage. Sélectionne **Demander** pour rétablir les confirmations. Le mode actif apparaît dans la barre d’état.

En Full accès, `run_command` utilise un vrai shell : Windows PowerShell 5.1 sous Windows, le shell système sous macOS/Linux. Les scripts multilignes, variables, boucles, pipelines et redirections fonctionnent ; `cwd` accepte aussi un dossier absolu hors du projet. Chaque appel démarre un nouveau shell dans le dossier demandé. Les commandes longues peuvent être suivies avec `background`, `job_output` et `job_stop`. Le bouton Stop interrompt la commande et ses descendants. Les droits restent ceux du compte qui lance l’application.

La recherche web automatique est activée par défaut dans **Paramètres → Accès web**. L’agent dispose de `web_search` (résultats Bing RSS, sans clé supplémentaire), puis de `web_fetch` pour lire et citer les sources. Il choisit quand rechercher, notamment pour les informations récentes et la documentation. Les règles du projet peuvent être placées dans `AGENTS.md` à la racine, en complément de `FRSTCLI.md`.

Les demandes suivantes sont intégrées directement au chat, sans bouton « À suivre » ni onglet dédié. **Stop**, une erreur ou un compte rendu `completed:false` suspend leur exécution. Les demandes non exécutées restent visibles au-dessus de la saisie avec un bouton **Reprendre** ; elles sont conservées par projet après un redémarrage.

Pendant que l’agent travaille, continuez à envoyer des messages avec **Entrée** : ils s’empilent juste au-dessus du champ de saisie et s’exécutent ensuite dans l’ordre. Chaque ligne permet de modifier, supprimer ou déplacer le prompt. **Orienter** transmet le prompt à la tâche en cours à sa prochaine étape, sans arrêter la commande en cours. Une consigne qui n’a pas encore été transmise revient dans la file si la tâche est interrompue. Les pièces jointes doivent être envoyées hors d’une tâche en cours.

Les onglets **Conversation** et **Activité** utilisent le thème Dark Modern d’origine. Les boutons, champs et sélecteurs partagent les mêmes styles que le chat. Le panneau Activité montre les actions, les sources effectivement consultées, les commandes en arrière-plan et les points de reprise. La lecture d’une sortie dans ce panneau ne consomme pas celle destinée à l’agent. Les restaurations concernent le journal des outils de fichiers ; elles n’annulent pas les commandes shell.

Le sélecteur du champ de saisie propose **Agent** ou **Plan · sans modifier**. Les boutons de la barre de saisie donnent accès aux prompts favoris, à leur enregistrement et à l’export Markdown de la conversation affichée. Les brouillons sont mémorisés par projet. Le bouton d’agrandissement permet de se concentrer sur l’agent.

## Centre d’extensions et paramètres

Le **Cockpit du projet** ajoute les exécutions de scripts, diagnostics, aperçus, comparaisons, repères, recherches en arrière-plan et outils locaux. L’éditeur dispose du formatage Prettier, de réglages d’apparence et d’options d’enregistrement automatique. La version installée prépare aussi les mises à jour via GitHub Releases. Voir [le guide du cockpit et des mises à jour](studio.md) pour les fonctions, formats pris en charge et conditions de distribution.

Le bouton Extensions ouvre une vue large qui laisse le chat accessible :

- **Bibliothèque** : 14 skills embarqués, recherche, catégories, aperçu des instructions et installation globale ou dans le projet.
- **Mes skills** : création et import d’un SKILL.md par copier-coller, édition intégrée, activation, favoris, filtres et affichage progressif. Les profils mémorisent l’ensemble actif ; appliquer un profil désactive les autres skills du catalogue courant. Un skill retiré est déplacé dans `.trash`, dans le dossier de ses skills.
- **Marketplace** : recherche SkillsMP, tri par étoiles GitHub ou récence, pagination, ouverture du dépôt et aperçu avant import. Les instructions communautaires sont installées désactivées. Seul le SKILL.md est téléchargé ; les scripts, ressources annexes et dépendances ne sont pas installés. Vérifie les instructions et la licence dans le dépôt avant d’activer un skill.
- **Serveurs MCP** : formulaire stdio (commande, arguments JSON, variables et dossier), état de connexion, outils disponibles, activation et retrait. La configuration précédente est gardée dans `mcp.json.backup`. Ajouter ou réactiver un serveur lance sa commande ; les variables sont stockées localement dans mcp.json.

La recherche SkillsMP fonctionne sans clé avec les limites du service. Une clé facultative peut être enregistrée dans **Paramètres → Marketplace SkillsMP** : elle est chiffrée via le stockage sécurisé du système et n’est pas renvoyée au renderer. `SKILLSMP_API_KEY` est prioritaire si définie. Voir la [documentation officielle SkillsMP](https://skillsmp.com/docs/api).

Les paramètres disposent d’une recherche, d’un modèle au démarrage et de trois préréglages de contexte (**Léger**, **Équilibré**, **Grand projet**). Les limites de fichiers, de budget total, d’extrait et de contexte initial sont réglables. Clique sur **Enregistrer ces réglages** : le modèle sera utilisé au prochain démarrage avec une nouvelle conversation ; les budgets à la prochaine indexation ou ouverture de dossier. Augmenter ces budgets peut augmenter la mémoire utilisée et le coût en tokens. Le cache des résumés est invalidé lorsque la taille d’un extrait change.

## Première utilisation

Le guide de démarrage s’ouvre si une connexion est nécessaire. Il peut aussi être rouvert avec le bouton **?** ou dans **Paramètres → Connexion et prise en main**.

Pour te déconnecter, ouvre **Paramètres → Connexion et prise en main → Se déconnecter**. Arrête d’abord toute tâche en cours. La session locale est effacée, les prompts en attente sont mis en pause et le guide permet de se reconnecter. Les fichiers et les conversations sont conservés ; la connexion du navigateur reste indépendante. La commande `/logout` effectue la même déconnexion dans l’application.

1. Saisis l’adresse e-mail et le mot de passe de ton compte FranceStudent, comme sur le site. Aucune clé API n’est demandée. Le mot de passe n’est pas conservé par l’application ni ajouté à la conversation ; seule la session de connexion est enregistrée. Une connexion nécessitant un captcha ou une double authentification supplémentaire n’est pas prise en charge par ce formulaire.
2. Choisis le dossier de ton projet. Tu peux passer cette étape pour poser des questions générales.
3. Prépare une première demande en français, puis appuie sur Entrée pour l’envoyer.

Les paramètres proposent **Demander**, **Automatique** et **Full accès**, avec une option pour garder le choix aux prochains démarrages. Les réglages détaillés restent dans **Autorisations personnalisées**. Un avertissement visible rappelle qu’en **Full accès**, l’agent peut agir sans confirmation, supprimer des fichiers, exécuter des commandes et envoyer des données sur Internet, y compris hors du projet. Ce mode utilise les droits du compte Windows et n’accorde pas automatiquement les droits administrateur.

L'interface principale est une application graphique façon VS Code (Electron). Elle réutilise le même cœur que la TUI et le CLI et propose :

- un explorateur de fichiers avec menu contextuel ;
- un éditeur à onglets (CodeMirror 6, fichiers de 2 Mo maximum) ;
- un panneau Agent pour la conversation et les confirmations ;
- un panneau du bas pour la sortie des commandes et le terminal intégré (xterm.js et node-pty) : PowerShell sous Windows, `$SHELL` ailleurs (à défaut `/bin/zsh`, puis `/bin/bash`) ;
- une vue Git (branche, diff, journal, commit, Pull, Fetch et Push) avec une section GitHub (token, remote, création de dépôt). Détails : [docs/github.md](github.md).

Lancement et construction :

| Commande | Rôle |
| -------- | ---- |
| `npm run desktop` | Lance l'application en développement (le renderer est reconstruit avant) |
| `npm run build:desktop` | Construit l'application sans installeur (`electron-builder --dir`) |
| `npm run dist:win` | Windows : `FranceStudentCode-<version>-portable.exe` et `FranceStudentCode-<version>-setup.exe` (NSIS) dans `release/` |
| `npm run dist:mac` | macOS (x64) : `FranceStudentCode-<version>-mac-x64.dmg` et `.zip` dans `release/` (sans signature de code) |

Sous macOS, Cmd remplace Ctrl dans les raccourcis ci-dessous.

| Raccourci | Action |
| --------- | ------ |
| Ctrl+P | Aller à un fichier (`>` pour les commandes, `:` pour une ligne) |
| Ctrl+Maj+P | Palette de commandes |
| Ctrl+Maj+F | Rechercher dans le projet (casse, regex) |
| Ctrl+Maj+E | Afficher/masquer l'explorateur |
| Ctrl+Maj+G | Afficher/masquer la vue Git |
| Ctrl+B | Afficher/masquer la barre latérale |
| Ctrl+² (ou Ctrl+`) | Afficher/masquer le terminal intégré |
| Ctrl+Maj+² (ou Ctrl+Maj+`) | Ouvrir un nouveau terminal |
| Ctrl+J | Afficher/masquer le panneau du bas |
| Ctrl+G | Aller à la ligne |
| Ctrl+N | Nouveau fichier |
| Ctrl+S / Ctrl+W / Ctrl+O | Enregistrer / fermer l'onglet / ouvrir un dossier |
| Ctrl+L | Aller à la saisie de l'agent |
| O / N / T | Répondre à une confirmation de l'agent (hors champ de saisie) |

Clic droit dans l'explorateur : nouveau fichier ou dossier, renommer, mettre à la corbeille, mentionner à l'agent, copier le chemin, afficher le fichier dans le gestionnaire de fichiers du système (Explorateur Windows ou Finder). Double-clic sur un bloc de code de la conversation pour le copier. Les tailles des panneaux sont mémorisées.


