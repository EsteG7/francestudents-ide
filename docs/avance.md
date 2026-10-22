# Guide avancé

[Retour au README](../README.md) · [Guide d’utilisation](guide-utilisation.md)

Cette page regroupe les réglages et les détails techniques de FranceStudent IDE. Elle décrit le code source actuel ; l’installateur d’une release antérieure peut proposer moins de fonctions.

Les paramètres sont regroupés par catégorie : Général, IA et contexte, Autorisations, Connexions et outils. La recherche parcourt toutes les catégories, même lorsqu’un filtre est sélectionné. Le bouton Tout retrouve l’ensemble des réglages.

## Agent, conversations et contexte

Le mode Agent peut lire et modifier le projet avec ses outils. Le mode Discussion sert aux échanges avec le modèle choisi. Les demandes ajoutées pendant une tâche sont placées dans la file : elles peuvent être modifiées, réordonnées, supprimées ou utilisées pour orienter la tâche en cours.

Le contexte peut inclure les instructions `AGENTS.md`, les fichiers ouverts, des informations sur le projet et les résultats des outils. La compaction résume les échanges quand le contexte approche de sa capacité, puis reprend dans une nouvelle conversation serveur. Elle s’adapte aux capacités connues du modèle et aux informations fournies par le service ; les limites effectives de FranceStudent peuvent différer de celles du fournisseur. [Capacités et méthode de calcul](model-context.md).

L’historique affiche les noms des modèles. La suppression demande confirmation ; le choix « Ne plus demander » est mémorisé et la confirmation peut être réactivée dans l’historique.

## Fichiers et consommation

Les fichiers peuvent être sélectionnés, collés lorsque le format le permet, ou déposés dans la zone de l’agent. Il n’y a pas de plafond de nombre de pièces jointes dans l’interface : les envois sont répartis automatiquement selon la limite de l’API. Les limites de taille, de conversion et de quota restent applicables.

Les PDF peuvent être rendus en images. Les documents Office, présentations, tableaux Excel, SVG et archives passent par des conversions ou extractions locales. Cela ne signifie pas une lecture parfaite de tous les formats : les documents protégés ou endommagés et certains contenus binaires ne donnent qu’un résultat partiel, signalé à l’IA. Les médias fournissent des métadonnées, sans transcription automatique garantie. [Formats, conversions et limites](attachments.md).

À partir de cinq fichiers joints, un avertissement rappelle le risque de forte consommation. Le nombre de pages et la taille du contenu comptent également.

La jauge de la barre d’état ouvre l’onglet **Usage** : quota de chat, réinitialisation, limites du compte, requêtes et tokens de la session. Les estimations sont distinguées des relevés du service. Les compteurs restent consultables pendant une tâche et l’actualisation ne lance aucune génération IA. Le quota du compte et les compteurs de cette ouverture de l’application couvrent des périodes différentes.

Le **mode Éco** réduit le contexte projet ajouté automatiquement à 20 000 caractères, limite l’agent à quatre tours et désactive les sous-agents, la recherche web intégrée et certaines reprises automatiques. Une fenêtre explique ces limites avant activation. Il peut laisser une tâche incomplète et ne fixe pas de plafond garanti de quota. [Fonctionnement du mode Éco](eco-mode.md).

## Continuer une conversation Codex — bêta

Ouvre d’abord ton projet existant, puis utilise **Importer Codex · Bêta**. Tu peux fournir un lien de partage compatible, un export Markdown/JSON/JSONL ou du texte collé. Après l’aperçu, choisis le modèle et prépare la reprise ; le contexte est joint au brouillon avant ton envoi.

L’import porte sur la conversation, pas sur les fichiers du projet. Il n’accède pas à ton compte Codex : les liens privés peuvent nécessiter un export. [Guide et limites de l’import](conversation-import.md).

## Éditeur, exécutions et aperçu web

Le cockpit rassemble les commandes du projet, leur sortie, les diagnostics et les actions de vérification. L’éditeur propose notamment la recherche, les symboles, les diagnostics JS/TS, Prettier et la comparaison de versions.

Le navigateur intégré ouvre les serveurs locaux. Lorsqu’une réponse contient une commande reconnue et une adresse locale non ambiguë, des boutons permettent de démarrer le serveur, de l’arrêter et d’ouvrir le site. La commande n’est jamais exécutée simplement parce qu’elle apparaît dans une réponse. [Contrôles de serveur](server-controls.md).

[Documentation du cockpit, de l’éditeur et des mises à jour](studio.md) · [Outils disponibles pour l’agent](tools.md).

## Permissions et extensions

Le mode **Demander** conserve les confirmations. **Full accès** permet les écritures, suppressions et commandes sans confirmation, avec les droits du compte qui lance l’application. Selon les outils, il peut aussi permettre l’accès à des fichiers hors du projet et l’envoi de données sur Internet. Il n’accorde pas automatiquement les droits administrateur.

En Full accès, chaque action en cours affiche **Annuler l’action** : l’application tente d’interrompre l’opération et écarte son résultat, puis l’agent continue les étapes suivantes. Un petit délai avant exécution permet d’intervenir sur les actions rapides. Les modifications de fichiers suivies proposent **Annuler la modification** après la tâche ; les commandes shell et effets distants déjà réalisés demandent une correction séparée. Le bouton Stop interrompt toujours la tâche entière.

Les permissions de capture se règlent séparément. Un serveur MCP exécute un programme local ; un skill apporte des instructions. Vérifie leur provenance et leur contenu avant activation. Le centre d’extensions propose les skills, profils et serveurs MCP stdio.

**Désinstaller** retire un skill et conserve son dossier dans `.trash`, à côté des autres skills de la même portée. **Retirer la connexion** enlève un serveur de `mcp.json`, avec sauvegarde ; cela ne supprime pas son programme de l’ordinateur. Les téléchargements communautaires affichent les octets réellement reçus, une barre indéterminée lorsque la taille totale est inconnue, ainsi que les boutons Annuler et Réessayer. Seul le SKILL.md est téléchargé : les scripts annexes ne sont pas installés.

[Intégration GitHub](github.md) · [Composants open source](studio.md#composants-open-source).

## Développer depuis les sources

Prérequis : **Node.js 22.13.0 ou plus récent**, npm et Git. Les langages, gestionnaires de paquets et outils propres aux projets ouverts doivent être installés séparément.

```powershell
git clone https://github.com/extraopaa/francestudents-ide.git
cd francestudents-ide
npm install
npm run desktop
```

| Commande | Usage |
| --- | --- |
| `npm run desktop` | Reconstruire l’interface et lancer Electron |
| `npm run lint` | Vérifier le code |
| `npm run check:renderer` | Vérifier que l’interface assemblée est à jour |
| `npm test` | Exécuter les tests unitaires |
| `npm run test:e2e` | Tester les parcours Electron dans un environnement graphique |
| `npm run build:desktop` | Générer une application locale non empaquetée en installateur |
| `npm run dist:win` | Générer le portable et l’installateur Windows dans `release/` |
| `npm run dist:mac` | Construire pour macOS Intel dans un environnement adapté |

Les modules natifs peuvent nécessiter les outils de compilation du système. Sous Windows, une erreur MSB8040 signale l’absence de bibliothèques Spectre dans Visual Studio Build Tools. Les exécutables macOS ne sont pas fournis par la release Windows.

Les sources de l’interface sont dans `desktop/renderer/src/`. Après modification, lance `npm run build:renderer` pour mettre à jour `desktop/renderer/app.js`.

Pour isoler les essais de tes données personnelles, définis `FS_DATA_DIR` et `FS_STATE_DIR` vers des dossiers de test. Ne publie jamais ces dossiers, tes sessions, tes identifiants ou tes fichiers `.env`.

## Contribuer et publier

Les corrections et améliorations sont décrites dans le [changelog](../CHANGELOG.md). Consulte [CONTRIBUTING.md](../CONTRIBUTING.md) pour les vérifications et la publication d’une release. Les exécutables sont distribués dans GitHub Releases, jamais dans les commits ; les portables restent locaux.

Le projet original est [EsteG7/francestudents-ide](https://github.com/EsteG7/francestudents-ide), et ce fork est maintenu par extraopaa. Le champ `author` historique du paquet, Hecone, est conservé. Le paquet déclare ISC ; aucun fichier `LICENSE` autonome n’est présent. Ce fork ne réattribue pas les droits du projet d’origine et les composants tiers conservent leurs licences. [Crédits](../CREDITS.md).
