# Sable, expliqué

**Un marché boursier où personne — pas même ceux qui le font tourner — ne peut voir ce que
chacun achète ou vend. Et qui trouve pourtant le bon prix.**

Cette phrase a l'air impossible. Ce document explique pourquoi elle ne l'est pas, comment nous
l'avons construit, et ce que ça démontre.

---

### Comment lire ce document

- **Deux minutes ?** Lisez *Le problème* et *L'idée*. C'est toute l'histoire.
- **Curieux de savoir comment c'est possible ?** Ajoutez *L'astuce* et *Une enchère, de bout
  en bout*.
- **Technique ?** Sautez directement à *Les parties difficiles* — c'est là qu'est l'ingénierie.
- **Vous pensez marchés et capitaux ?** *Pourquoi ça ne pouvait pas exister avant* et *Ce que
  ça débloque*.

Aucune connaissance en blockchain ou en IA n'est supposée. Quand un mot technique est
inévitable, il est expliqué sur place.

---

## Le problème

Imaginez que vous gérez un fonds de pension et que vous devez vendre un très gros bloc
d'actions.

À la seconde où quelqu'un l'apprend, vous êtes en difficulté. Les traders qui découvrent
qu'un gros vendeur arrive vendent avant vous, font baisser le prix, puis vous rachètent bon
marché. Vous obtenez un moins bon prix, et la différence part dans leur poche. Ce n'est ni une
hypothèse ni une faille : c'est l'un des phénomènes les mieux documentés de la finance. **Le
simple fait d'être vu vous coûte de l'argent.**

Depuis des décennies, les grandes institutions utilisent donc des **dark pools** : des lieux
d'échange privés où placer un gros ordre sans l'annoncer. Une part importante des transactions
actions américaines — régulièrement plus d'un tiers — a désormais lieu hors des bourses
publiques.

Les dark pools ont un défaut structurel. Quelqu'un doit les opérer — et ce quelqu'un, lui,
voit tout. Vous n'évitez pas l'exposition : vous la concentrez sur une seule partie, en
espérant qu'elle se tienne. Ça n'a pas toujours été le cas. En 2016, Barclays et Credit Suisse
ont tous deux transigé avec le régulateur américain pour avoir mal représenté le
fonctionnement réel de leurs dark pools et qui était autorisé à y voir le flux.

Voilà l'étau. **Un marché qui cache votre ordre a besoin d'un opérateur qui le voit. Un
opérateur qui voit est un opérateur qui peut tricher.**

## L'idée

Sable est un marché où l'opérateur *ne peut pas* tricher, parce qu'il ne peut pas voir.

Pas « s'engage à ne pas regarder ». Pas « journalise chaque accès ». Ne peut pas. Les ordres
arrivent chiffrés, le prix est calculé alors qu'ils le restent, et les seules choses qui
deviennent lisibles sont le prix final, le volume total échangé, et — en privé, pour chacun
seul — la part de son propre ordre qui a été exécutée.

Il n'y a pas d'administrateur avec une clé maîtresse. Pas de « bris de glace en cas
d'urgence ». Le code qui fait tourner le marché est public et lisible par n'importe qui. Ce
sur quoi il opère est mathématiquement opaque pour tout le monde, y compris pour nous qui
l'avons écrit.

## L'astuce

Voici la partie qui a l'air de la science-fiction et qui n'en est pas.

Il existe une branche de la cryptographie qui permet à plusieurs parties qui ne se font pas
confiance de calculer un résultat commun à partir de leurs données privées — sans qu'aucune ne
révèle ses données, et sans intermédiaire de confiance. La théorie a des décennies. Jusqu'à
récemment, c'était bien trop lent pour servir.

Une image utile : chacun écrit son ordre sur un bout de papier et le scelle dans une
enveloppe. Au lieu d'une personne qui ouvre les enveloppes, imaginez une machine
*physiquement incapable* de montrer à qui que ce soit ce qu'elles contiennent, mais qui sait
tout de même additionner les papiers et imprimer le prix qui en résulte. Les plans de la
machine sont publiés, donc vous pouvez vérifier qu'elle fait exactement ce qu'elle annonce —
vous ne pouvez simplement pas voir le papier. Ni vous, ni son constructeur, ni personne.

La technique s'appelle les **circuits garbled** (*garbled circuits*). Le réseau sur lequel
Sable tourne — [COTI](https://coti.io) — les rend assez rapides pour être réellement
utilisables, et c'est cette avancée qui rend ce projet possible au lieu de simplement
descriptible.

Deux conséquences à garder en tête, parce que tout le reste en découle :

1. **L'ordinateur n'apprend jamais les valeurs qu'il manipule.** Il les traite comme vous
   déplaceriez des enveloppes scellées : correctement, et à l'aveugle.
2. **Il ne peut donc pas prendre de décisions de la façon habituelle.** J'y reviens dans *Les
   parties difficiles* — c'est la contrainte d'ingénierie la plus intéressante du projet.

## Une enchère, de bout en bout

Plutôt que de décrire Sable dans l'abstrait, voici une exécution qui a réellement eu lieu sur
le réseau de test de COTI. Chaque chiffre ci-dessous a été produit par le système en
fonctionnement, et chacun a été confronté à un modèle écrit indépendamment de ce qui *devait*
se passer.

Trois desks de trading automatisés participent. Chacun a ses instructions privées — combien
échanger, le pire prix acceptable — qui ne quittent jamais sa propre machine.

### Étape 1 — Ils se sondent, en privé

Avant de s'engager, les desks s'envoient des messages chiffrés : *« j'ai un intérêt de cette
taille, de ce côté ».* Délibérément aucun prix. Seul le destinataire prévu peut lire chaque
message ; pour tous les autres, c'est du bruit.

Six messages sont partis. Puis chaque desk a évalué ce qu'il venait d'apprendre :

```
Atlas     voit 20 d'intérêt à l'achat et 65 à la vente
          → visait 70, ne voit que 65 d'offre, engage donc 65 et retient 5
Borealis  voit 70 et 20 à l'achat, 65 à la vente
          → engage ses 20 en totalité
Cygnus    voit 70 et 20 d'intérêt à l'achat
          → engage ses 65 en totalité
```

La ligne du milieu mérite qu'on s'arrête. **Atlas a volontairement réduit son propre ordre**
parce que la conversation chiffrée lui a appris que l'autre côté du marché n'était pas assez
gros pour absorber le montant complet. S'engager sur une transaction implique d'immobiliser du
collatéral : Atlas en a bloqué 6 639 unités au lieu de 7 150 — environ 7 % de capital en moins
— et n'a rien perdu à le faire, puisque ce surplus n'allait de toute façon pas s'échanger.

Voilà la négociation privée qui rapporte, de façon mesurable. Et ça ne marche *que* parce que
les messages sont chiffrés : annoncer « j'ai besoin d'acheter 70 » à découvert revient à dire
au marché de monter son prix contre vous.

### Étape 2 — Les ordres scellés entrent

Chaque desk soumet ses vrais ordres, chiffrés : quel sens, à quel prix, quelle quantité. Six
ordres au total. N'importe qui sur terre peut les consulter. Personne ne peut les lire.

À ce moment les desks immobilisent aussi du collatéral, pour qu'une transaction, une fois
appariée, soit garantie de se régler. Le montant bloqué est chiffré lui aussi — et les deux
types de jetons sont **toujours** déplacés, l'un d'eux d'un zéro chiffré, pour que même
*quel* jeton a bougé ne dise rien sur le sens de l'ordre.

### Étape 3 — Le marché trouve le prix, à l'aveugle

À un instant fixé, la fenêtre se ferme et n'importe qui peut déclencher le règlement. Pas un
opérateur privilégié — n'importe qui. Il n'y a personne à corrompre, à retarder ou à
supplier.

Le marché détermine alors le prix unique auquel la plus grande quantité possible peut
s'échanger. Il le fait sur l'ensemble des ordres scellés, sans jamais en ouvrir un seul.

Résultat : **prix 101, et 65 unités ont changé de main.**

Ces deux nombres deviennent publics. C'est précisément le but — un prix est un bien commun,
utile à tous. Tout ce qui l'a produit reste scellé à jamais.

### Étape 4 — Chaque desk apprend son exécution, et seulement la sienne

Chaque participant peut maintenant déchiffrer un nombre : quelle part de son propre ordre est
passée.

```
Atlas     ordre 1 → 37 exécuté     Cygnus  ordre 1 → 20 exécuté
Atlas     ordre 2 → 28 exécuté     Cygnus  ordre 2 → 35 exécuté
Borealis  ordre   →  0 exécuté     Cygnus  ordre 3 → 10 exécuté
```

Le prix de Borealis était trop bas pour traiter à 101, il n'a donc pas traité — et a récupéré
chaque unité de son collatéral. Son ordre reste scellé définitivement. **Un ordre qui ne
s'exécute pas ne révèle absolument rien, pour toujours.** Sur un marché classique, les ordres
non exécutés sont précisément ce qui trahit vos intentions.

Nous avons testé la confidentialité directement, plutôt que de l'affirmer. Cygnus a tenté de
déchiffrer l'exécution de 37 d'Atlas. Il a obtenu `3.3383808768725014e+38` — du bruit sans
signification. Voici le tableau complet, mesuré :

```
sans aucune clé            lit 0 ordre sur 6
avec la clé d'Atlas        lit 2 sur 6   (exactement les deux siens)
avec celle de Borealis     lit 1 sur 6   (exactement le sien)
avec celle de Cygnus       lit 3 sur 6   (exactement les trois siens)
```

Chaque participant voit précisément ses propres lignes. Pas une de plus.

### Étape 5 — L'argent circule, toujours en privé

Chaque desk encaisse ce qui lui est dû. Les montants sont chiffrés, donc les soldes ne
trahissent pas les positions. Les comptes se sont équilibrés exactement :

```
Atlas    reçoit 65 unités, paie 6 565
Cygnus   livre 65 unités, reçoit 6 565
Borealis inchangé — intégralement remboursé
```

Et une touche finale : la couche de messagerie qui a porté la négociation privée **paie les
desks pour l'avoir utilisée.** Chacun a touché une petite récompense pour les données
chiffrées qu'il a stockées. L'infrastructure finance la confidentialité dont elle dépend.

## Ce qui est public, et ce qui ne l'est jamais

| Visible par tous | Invisible pour tous, à jamais |
|---|---|
| Qu'une adresse a passé un ordre, et quand | S'il s'agissait d'un achat ou d'une vente |
| Le prix final de chaque enchère | Le prix qu'elle était prête à accepter |
| Le volume total échangé | La taille de son ordre |
| Que le règlement a eu lieu | La part qui a été exécutée |
| Le code source complet du marché | **Absolument tout des ordres non exécutés** |

## Pourquoi une enchère, et pas une bourse classique

Une bourse classique apparie les ordres en continu — dès que deux s'accordent, ils
s'échangent. Ce design récompense la vitesse, ce qui explique les sommes investies à gratter
des millisecondes, et il est à la racine de toute une catégorie d'extraction de valeur où
celui qui voit votre ordre en premier en profite.

Sable collecte au contraire les ordres pendant une fenêtre et les règle tous ensemble à **un
prix partagé**. Tous ceux qui traitent dans une enchère obtiennent le même prix. Personne ne
gagne à être une microseconde plus tôt.

Ce n'est pas une invention, et c'est un atout : c'est le design de l'enchère de clôture qui
fixe chaque jour les prix officiels des grandes bourses, avec une littérature académique
solide derrière. L'apport de Sable est que ce mécanisme n'avait jamais tourné sur des ordres
que personne ne peut lire.

Effet de bord agréable : puisque tout le monde règle au même prix, il y a peu à gagner à
mentir sur ce qu'on est prêt à payer. Annoncer sa limite honnête est la stratégie sensée. Le
mécanisme fait le travail qui exigerait sinon de la théorie des jeux.

## Les parties difficiles

*Cette section est pour qui veut l'ingénierie. Sautez sans remords.*

### On ne peut pas poser de question à une donnée chiffrée

Le code normal branche : *si le prix dépasse 100, faire ceci.* Sable ne peut pas.
L'ordinateur ne sait véritablement pas si le prix dépasse 100 — c'est tout l'objet.

Chaque décision doit donc être reformulée en arithmétique qui produit la bonne réponse sans
que personne ne sache de quel côté elle est tombée. Au lieu de choisir entre deux chemins, on
calcule *les deux* et on les mélange avec un sélecteur lui-même chiffré. Toutes les conditions
du marché — est-ce un achat, ce prix est-il assez haut, cet ordre a-t-il participé —
fonctionnent ainsi.

Une conséquence, découverte tôt : l'opération dont tout dépend, le « choisis A ou B » chiffré,
se comporte **à l'envers** de toutes les conventions. `choisis(condition, A, B)` renvoie *B*
quand la condition est vraie. Ce n'est documenté nulle part et c'est invisible depuis le code
source, parce que l'opération est exécutée par le réseau et non par le programme.

Se tromper là-dessus, et le marché sélectionne silencieusement exactement les ordres qui ne
devaient *pas* participer, produit un prix faux mais plausible, et ne lève aucune erreur —
puisque toutes les valeurs en jeu sont chiffrées, il n'y a rien à inspecter. Notre première
version avait ce bug.

Ce qui l'a attrapé, c'est une décision prise avant toute mesure : construire un petit marché à
la main, calculer sur papier quelle devait être la bonne réponse, et refuser de faire
confiance au système jusqu'à ce qu'il la reproduise exactement. **En calcul chiffré, un test
dont on connaît la réponse d'avance vaut plus que n'importe quelle relecture de code.** On ne
débogue pas ce qu'on ne peut pas voir.

### Une erreur d'arrondi qui aurait vidé le marché

Il arrive que plus de gens veuillent acheter que vendre. La demande excédentaire doit être
rationnée, chaque acheteur recevant une part proportionnelle à son ordre.

La façon évidente de le faire est subtilement et dangereusement fausse. Donnez à chaque
acheteur `sa taille × volume échangé ÷ demande totale`, arrondi à l'inférieur, et les deux
côtés du marché cessent de coïncider : les acheteurs reçoivent collectivement un peu plus que
ce que les vendeurs ont collectivement livré. Le marché paierait plus qu'il n'a encaissé — à
chaque enchère où un rationnement a lieu, indéfiniment.

Concrètement : 7 unités de demande face à 10 d'offre, avec des vendeurs à 5 et 5, donne 7
unités aux acheteurs en n'en prenant que 6 aux vendeurs. Une unité manquante. Chaque fois.

La correction arrondit le *cumul* plutôt que chaque part :

```
part de l'ordre i = arrondi(cumul jusqu'à i inclus) − arrondi(cumul jusqu'à i−1)
```

Écrit ainsi, les arrondis s'annulent le long de la chaîne, et les parts totalisent exactement
le bon montant des deux côtés — toujours, sans étape de réconciliation et sans reliquat. Les
comptes s'équilibrent **par la formule**, pas parce que quelque chose les vérifie après coup.

Vérifié sur un marché délibérément déséquilibré : 85 unités échangées, acheteurs rationnés à
85 % de leur demande, et les deux côtés totalisant exactement 85. Collatéral entré égal au
versement sorti, à l'unité près, dans les deux devises.

### Le calcul chiffré est bon marché. Les portes chiffrées sont chères.

Les blockchains facturent le calcul, nous avons donc mesuré le coût de chaque opération avant
de concevoir quoi que ce soit. Le résultat a inversé nos hypothèses :

| Opération | Coût |
|---|---|
| Comparer deux nombres chiffrés | 9 917 |
| Additionner, mélanger, prendre le minimum | ~13 000 |
| Multiplier, diviser | ~34 000 |
| **Faire entrer ou sortir une valeur du domaine chiffré** | **~48 000** |

Faire de l'arithmétique sur des secrets est presque gratuit. Les *manipuler* — faire entrer un
secret stocké pour travailler dessus, ou resceller un résultat — coûte quatre fois plus que de
calculer avec.

Ce seul tableau a piloté la conception. Restructurer le marché pour que chaque ordre soit
descellé une fois et réutilisé partout, au lieu d'être descellé à chaque besoin, l'a rendu
environ 2,4× moins cher. Une passe ultérieure a retrouvé la même économie dans l'étape de
règlement, réduisant son coût de 37 %. Les deux améliorations ont été *prédites depuis le
tableau puis confirmées par la mesure* — les chiffres correspondaient à 0,2 % près.

Le modèle de coût qui en résulte :

```
coût(ordres, niveaux de prix) = 132 064 + 164 081·ordres + 103 275·ordres·niveaux + 52 278·niveaux
```

Il prédit les mesures réelles à 0,6 % près, ce qui permet de dimensionner le marché par
l'arithmétique plutôt qu'au doigt mouillé. Une enchère réglée de six ordres sur douze niveaux
de prix a mesuré 13 130 009 — environ 11 % de ce qu'un bloc peut contenir. Le modèle place le
plafond autour de 48 ordres à ce nombre de niveaux.

### Une sortie de secours, parce que détenir l'argent d'autrui l'exige

Le règlement est l'opération la plus coûteuse du système. S'il devenait un jour impossible à
exécuter, le collatéral de cette enchère serait piégé — et, vu la façon dont le marché passe
d'une enchère à la suivante, aucune enchère future ne pourrait plus jamais s'ouvrir. Une
seule enchère bloquée mettrait fin au marché, définitivement.

Il existe donc une issue : après un délai généreux, **n'importe qui** peut abandonner une
enchère non réglée et rendre intact le collatéral de chaque participant. Elle fonctionne par
tranches, pour qu'aucune enchère ne puisse être trop grosse à dénouer — une sortie de secours
qui pourrait échouer de la même manière que ce qu'elle secourt n'en serait pas une.

Testée de bout en bout : refusée pendant que le marché était encore ouvert, refusée à nouveau
avant l'expiration du délai, puis dénouée en deux tranches appelées par deux personnes
différentes, les trois participants remboursés à un écart de exactement zéro, et le marché
acceptant de nouveaux ordres immédiatement après.

## Pourquoi ça ne pouvait pas exister avant

Vous avez peut-être entendu parler des preuves à divulgation nulle (*zero-knowledge*), la
cryptographie derrière l'essentiel des travaux sur la confidentialité dans ce domaine. Elles
sont remarquables, et elles résolvent un autre problème : prouver quelque chose sur *vos
propres* données sans les révéler.

Une enchère demande strictement plus difficile. Le prix d'équilibre est une fonction des
ordres privés **de tout le monde à la fois**. Aucun participant ne peut le calculer — il lui
faudrait les secrets des autres. Et la partie à qui on confierait normalement ce calcul est
précisément celle qui ne doit pas voir.

Cela exige de calculer sur des données appartenant à plusieurs parties qui se méfient
mutuellement. C'est une autre branche de la cryptographie, et jusqu'à ce qu'elle devienne
assez rapide pour tourner dans une blockchain, un marché comme celui-ci restait une
expérience de pensée.

C'est en ce sens que Sable n'est pas « la version privée d'un produit existant ». C'est un
mécanisme qui n'avait aucune implémentation, parce que les mathématiques permettant de le
faire tourner honnêtement n'existaient pas sous forme utilisable.

## Ce que ça débloque

L'usage immédiat est celui que nous avons construit : institutions et traders automatisés qui
déplacent de la taille sans payer le prix d'être vus.

Le plus intéressant est ce qui cesse d'être un compromis dès qu'un marché dispose du calcul
confidentiel :

**Les enchères sous pli scellé de toute nature.** Marchés publics, fréquences, art, crédits
carbone — partout où les enchérisseurs biaisent aujourd'hui leurs offres par crainte de
révéler leur vraie valorisation.

**Les marchés entre agents IA.** Les agents logiciels commencent à détenir des budgets et à
transiger de façon autonome. La stratégie d'un agent *est* sa valeur, et sur un registre
transparent chaque action qu'il pose publie cette stratégie. La confidentialité n'est pas une
fonctionnalité du commerce entre agents ; c'en est la condition préalable. Les trois desks de
Sable en sont une instance qui fonctionne : ils négocient, décident, traitent et règlent sans
humain dans la boucle et sans divulguer de stratégie.

**La découverte de prix sans divulgation.** Sable produit un prix public et exploitable à
partir d'entrées qui restent privées. Cette combinaison — un bien commun bâti sur des données
protégées — se généralise bien au-delà du trading.

## Des preuves, pas des promesses

Tout ce qui est décrit ici tourne aujourd'hui sur le réseau de test de COTI, et chaque
affirmation ci-dessus est vérifiée par un test automatisé plutôt qu'affirmée.

Ces tests ont une particularité qui mérite d'être mentionnée. Puisque le calcul chiffré ne
peut pas être inspecté pendant son exécution, nous avons écrit une **seconde implémentation
indépendante** de la logique du marché, en code simple et lisible, opérant sur des nombres
ordinaires et visibles. Le vrai marché chiffré est confronté à cette référence à chaque
exécution. Quand les deux divergent, quelque chose est faux ; et contrairement à une
relecture de code, cela attrape les erreurs qui produisent des réponses crédibles mais
incorrectes.

Deux scénarios complets sont vérifiés de bout en bout à chaque exécution :

| | Marché équilibré | Marché déséquilibré |
|---|---|---|
| Prix trouvé | 101 | 101 |
| Volume échangé | 65 | 85 |
| Exécutions individuelles | les six exactes | les six exactes, rationnement appliqué |
| Comptes équilibrés | les deux côtés exactement | les deux devises exactement |
| Mouvements d'argent | exacts pour les trois | exacts pour les trois |
| Confidentialité | chacun ne voit que le sien | chacun ne voit que le sien |

Coûts mesurés, pour les esprits techniques :

| Action | Coût | Part d'un bloc |
|---|---|---|
| Placer un ordre scellé | ~2,8M | 2 % |
| Six messages de négociation chiffrés | 3,1M | 3 % |
| Régler une enchère de six ordres | 13,1M | 11 % |
| Encaisser ce qui vous est dû | 1,4M – 4,0M | 1–3 % |
| Dénouer une enchère abandonnée | ~0,5M par ordre | moins de 1 % |

## Essayez vous-même

Tout est open source et tourne contre un réseau de test public. Aucun argent réel n'est
impliqué à aucun moment.

```bash
npm install
npm run check          # la logique du marché, vérifiée hors ligne — sans réseau, sans coût

npm run wallet         # crée un compte de test, à financer gratuitement sur faucet.coti.io

STAGE=setup   npm run agents   # déploie un marché et trois desks
STAGE=rfq     npm run agents   # les desks négocient, chiffré
STAGE=submit  npm run agents   # ils décident et placent des ordres scellés
STAGE=clear   npm run agents   # le marché trouve le prix, à l'aveugle
STAGE=claim   npm run agents   # l'argent circule, confidentialité vérifiée
STAGE=rewards npm run agents   # les desks encaissent leurs récompenses de messagerie
```

Et un terminal pour l'observer :

```bash
cd frontend && npm install && npm run dev
```

Il s'ouvre en affichant le carnet d'ordres complet — et chaque valeur sous forme de bloc
plein, parce que c'est authentiquement ce qui est stocké. Déverrouillez la clé d'un desk et
ses lignes se résolvent en chiffres tandis que toutes les autres restent illisibles. Ce n'est
pas l'interface qui joue les mystérieuses. C'est le marché.

## Ce que contient le dépôt

```
contracts/SableCross.sol      le marché lui-même : ordres, collatéral, prix, règlement
contracts/GasSpike.sol        le banc de mesure derrière chaque chiffre de ce document

scripts/agents/               les trois desks : instructions privées, décisions, comportement
scripts/agents/reference.ts   la seconde implémentation indépendante qui vérifie la première
scripts/run-agents.ts         une exécution complète, de bout en bout
scripts/test-rescue.ts        la sortie de secours, mise à l'épreuve
scripts/stress-max-orders.ts  le marché à sa propre limite de capacité

frontend/                     le terminal — une fenêtre publique sur un carnet scellé

SPIKE.md                      comment chaque coût de ce document a été mesuré
README.md                     le point d'entrée technique
```

---

*Sable a été construit pour le [COTI Vibe Code Challenge — Web 4 Agent Edition](https://stay.coti.io/vibe-coding/).
Il tourne sur le réseau de test public de COTI. Licence MIT.*
