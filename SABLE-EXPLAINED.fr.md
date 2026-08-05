# Sable

**Une enchère d'appel à prix uniforme, sous pli scellé, dont le moteur d'appariement s'exécute
on-chain sur des ordres chiffrés, sans qu'aucun opérateur puisse lire le carnet.**

Les ordres sont soumis en clair-texte chiffré — sens, prix limite, taille. Le prix d'équilibre
et l'allocation au prorata sont calculés sous circuits garbled sur le gcEVM de COTI, sans
qu'aucun ordre ne soit jamais déchiffré. Deux valeurs deviennent publiques par enchère : le
prix uniforme et le volume total apparié. Chaque participant peut déchiffrer exactement une
valeur de plus : sa propre exécution. Rien d'autre n'est récupérable par qui que ce soit, y
compris par les auteurs du contrat.

La boucle complète — négociation bilatérale chiffrée entre agents autonomes, soumission
scellée, appariement à l'aveugle, règlement confidentiel en PrivateERC20 — tourne sur le
testnet COTI et est vérifiée contre une implémentation indépendante en clair du même
mécanisme.

---

### Portée de ce document

C'est le dossier complet de conception et de vérification : la microstructure du marché, le
modèle d'exécution confidentielle, les contraintes d'ingénierie propres au calcul sur données
garbled, le modèle de coût mesuré, et le confinement des défaillances. Il suppose une
familiarité avec l'exécution blockchain et avec les agents autonomes ; il ne suppose aucune
exposition préalable au calcul multipartite sécurisé, introduit là où il compte.

Tous les chiffres cités sont mesurés sur testnet, sauf attribution explicite au modèle de
coût.

- **Microstructure et mécanisme :** §1–§4
- **La couche agents :** §5
- **Une exécution vérifiée, avec la mesure de confidentialité :** §6–§7
- **Les enseignements d'ingénierie — la partie substantielle :** §8–§10
- **Positionnement et applications :** §11–§12
- **Méthodologie de vérification et reproduction :** §13–§15

---

## 1. Le problème

Exécuter sur un venue transparent divulgue l'ordre avant son règlement. Sur un DEX public la
séquence est mécanique : la transaction entre dans la mempool, sa taille et son sens sont
lisibles, le prix se déplace contre elle avant l'inclusion. Ce n'est pas un défaut
d'implémentation à corriger au niveau applicatif — c'est une propriété de l'exécution d'une
intention sur un registre où l'intention est visible. Toutes les mitigations déployées jusqu'ici
(relais privés, schémas d'engagement, inclusion par lots) réduisent la fenêtre sans supprimer
l'asymétrie sous-jacente : l'ordre finit visible par celui qui le règle.

La finance traditionnelle a traité la même asymétrie avec les dark pools, et en a hérité un
autre problème. Un dark pool dissimule l'ordre au marché, pas à son opérateur. Le risque de
contrepartie est remplacé par un risque d'opérateur, concentré sur une seule partie dont
l'incitation à observer le flux est exactement proportionnelle à la valeur de ce flux.
L'historique est sans ambiguïté : en 2016, Barclays et Credit Suisse ont tous deux transigé
avec la SEC et le procureur général de New York pour avoir mal représenté la façon dont leurs
dark pools classaient et exposaient le flux d'ordres.

La contrainte est structurelle. **Un venue qui dissimule votre ordre requiert un opérateur ;
un opérateur capable de lire le carnet est capable de traiter contre lui.** Une
confidentialité garantie par une politique est une confidentialité conditionnée aux
incitations de l'opérateur.

Sable sort l'opérateur du périmètre de confiance. Pas en auditant les accès, pas en attestant
d'une politique — en rendant le carnet illisible pour le processus qui l'apparie.

## 2. Conception

Sable est une enchère d'appel périodique. Les ordres s'accumulent pendant une fenêtre
d'engagement ; à sa fermeture, n'importe quelle adresse peut déclencher l'appariement. Le
contrat calcule un prix uniforme unique maximisant le volume croisé, rationne le côté long au
prorata, et règle les deux jambes en jetons confidentiels. Chaque valeur intermédiaire de ce
calcul est un handle garbled. Aucun branchement du code Solidity ne lit jamais une valeur
chiffrée.

Le modèle de confiance qui en résulte :

- **Aucun rôle privilégié.** L'appariement est sans permission. Il n'y a pas d'opérateur à
  corrompre, retarder ou assigner, ni clé d'administration, clé maîtresse ou clé de
  récupération. La sortie de secours du §10 est appelable par n'importe qui et ne peut que
  rendre le collatéral à son déposant.
- **Aucun matériel de confiance.** La confidentialité repose sur du calcul multipartite, pas
  sur une enclave dont le fournisseur constitue un point de compromission unique.
- **Mécanisme public, entrées privées.** Le contrat est lisible et le mécanisme intégralement
  auditable. Ses entrées sont cryptographiquement opaques, symétriquement, pour tout le monde
  — nous compris.

## 3. Le modèle d'exécution confidentielle

Le gcEVM de COTI étend l'EVM d'une couche MPC à circuits garbled. Les propriétés qui comptent
pour un concepteur de marché :

**Deux domaines de valeurs.** Une valeur chiffrée existe soit comme *ciphertext* en stockage
(`ctUint64`, `ctBool`), soit comme *handle garbled* valide le temps d'une transaction
(`gtUint64`, `gtBool`). L'arithmétique et les comparaisons opèrent sur les handles. Passer
d'un domaine à l'autre — `onBoard` pour hisser du stockage vers le calcul, `offBoard` pour
resceller un résultat — est une opération explicite, avec son propre coût, et ce coût domine.
Le §9 le quantifie.

**Les entrées chiffrées sont liées à l'appel.** Une entrée de transaction (`itUint64`) est
chiffrée sous une clé dérivée de l'émetteur, du contrat cible et du sélecteur de fonction :
un ciphertext ne peut pas être rejoué contre un autre point d'entrée.

**Deux cibles d'offboarding, non interchangeables.** `offBoard` scelle sous la clé réseau et
produit un ciphertext que le contrat pourra ré-hisser vers le calcul. `offBoardToUser` scelle
sous la clé AES d'un utilisateur précis et produit un ciphertext que seul lui peut déchiffrer,
et que le contrat ne pourra jamais ré-onboarder. Se tromper est une erreur d'exécution, pas de
compilation ; le §8 dit ce que ça nous a coûté.

**Il n'y a pas de branchement.** La couche d'exécution n'apprend pas les valeurs qu'elle
manipule, donc le flot de contrôle ne peut pas en dépendre. Chaque conditionnelle du marché
doit s'exprimer comme une sélection oblivieuse — calculer les deux branches, les mélanger sous
un sélecteur chiffré. C'est l'unique contrainte qui façonne toute l'implémentation, et le §8
porte largement sur ses conséquences.

## 4. Mécanisme

### Appariement

Sur une grille de prix publique et strictement croissante `P = [p₁ … p_K]`, tous les champs
d'ordre étant chiffrés :

```
pour chaque tick k :
  demande(k) = Σᵢ mux( estAchatᵢ ∧ limiteᵢ ≥ p_k , tailleᵢ , 0 )
  offre(k)   = Σᵢ mux( ¬estAchatᵢ ∧ limiteᵢ ≤ p_k , tailleᵢ , 0 )
  croisé(k)  = min( demande(k), offre(k) )

k* = argmax_k croisé(k)
```

`demande` est décroissante en `k` et `offre` croissante : les courbes se croisent exactement
une fois. `k*` est donc le prix maximisant le volume par construction, et non par heuristique
de recherche. L'argmax est réalisé par une chaîne de `mux` avec un `>` strict, ce qui résout
les égalités sur le tick le plus bas, de façon déterministe.

La grille est publique. C'est une divulgation délibérée : elle borne le coût d'appariement à
`O(ordres × niveaux)` et ne révèle rien du carnet, puisque la présence d'un tick dans la
grille ne dit rien de l'existence d'un ordre à ce niveau.

### Allocation, et l'invariant qui garde le contrat solvable

Le côté long est rationné au prorata de la taille des ordres, toujours chiffré. La formule
directe est subtilement et dangereusement fausse.

Le côté court vérifie `totalCôté == apparié` : son ratio vaut exactement 1 et il ne tronque
jamais. Le côté long, calculé comme `⌊tailleᵢ · apparié / totalCôté⌋`, tronque — mais par
ordre, si bien que les troncatures individuelles ne somment pas à la troncature agrégée. Les
deux côtés déplacent alors des quantités de base différentes, alors que le contrat ne détient
exactement que ce qui a été déposé. Le contrat verse plus qu'il n'a encaissé, à chaque enchère
où un rationnement survient.

Un contre-exemple à une unité près : 7 de demande contre 10 d'offre, vendeurs à 5 et 5. Les
acheteurs reçoivent 7 ; les vendeurs livrent 3 + 3 = 6. Une unité manquante, définitivement,
et indétectable depuis l'intérieur d'un calcul chiffré.

La correction arrondit la part *cumulée* et prend les différences :

```
cum_i  = Σ des tailles des participants du même côté jusqu'à i inclus
q_i    = ⌊ cum_i · V / T ⌋
fill_i = q_i − q_{i−1}
```

Les quotients se télescopent : les exécutions totalisent `⌊T·V/T⌋ = V` exactement des deux
côtés, chacune restant à une unité de sa part idéale. La conservation de la valeur est une
propriété de la formule, pas le produit d'une passe de réconciliation — ce qui importe,
puisqu'une telle passe devrait brancher sur des quantités chiffrées.

Ni l'appariement ni l'allocation ne branchent sur l'identité du côté long. Ce fait est
lui-même chiffré.

### Collatéral et règlement

`submitOrder` dépose sous un mux, de sorte que la jambe de collatéral est choisie de façon
oblivieuse :

```
collatQuote = mux( estAchat, 0, taille × limite )   // achat → taille × limite
collatBase  = mux( estAchat, taille, 0 )            // achat → 0
```

Les deux jambes de jetons sont **toujours** transférées, l'une d'un zéro chiffré. Un motif de
transferts qui varierait avec le sens divulguerait le sens : il ne varie pas.

`PrivateERC20._update` se termine par un `require` sur un bit de succès déchiffré : un dépôt
insuffisamment provisionné revert. Le collatéral est contraignant, pas indicatif.

Le règlement est en mode *pull*. L'appariement écrit trois ciphertexts par ordre — `fill` sous
la clé du trader, `baseOut` et `quoteOut` sous la clé réseau — et chaque trader appelle
lui-même `claim()`. L'appariement reste ainsi à coût fixe quel que soit le nombre de
participants, et le coût (dominant) du transfert chiffré est porté par la partie qui en
bénéficie. Le §9 montre que cette répartition n'est pas accessoire.

L'admissibilité est contrôlée à la soumission avec exactement un déchiffrement délibéré — un
seul bit :

```solidity
gtBool admissible = and( le(size, maxOrderSize),
                         and( ge(limit, ticks[0]), le(limit, ticks[K-1]) ) );
if (!MpcCore.decrypt(admissible)) revert OrderOutsideBounds();
```

Un bit fuit : le fait qu'un ordre rejeté était hors bornes. En échange, les bornes
d'overflow du constructeur deviennent contrôlables au lieu d'être supposées —
`MAX_ORDERS × maxOrderSize ≤ 2³²−1` et `maxOrderSize × topTick ≤ 2⁶⁴−1`, vérifiées au
déploiement, maintiennent chaque produit du noyau dans `uint64` sans un seul test d'overflow
chiffré dans le chemin chaud.

### Pourquoi une enchère d'appel plutôt qu'un carnet continu

L'appariement continu restaure la latence comme avantage et réimporte les jeux d'ordonnancement
qui ont motivé la conception. Une enchère périodique à prix uniforme supprime la course à la
vitesse par construction : à l'intérieur d'une enchère, l'ordre d'arrivée n'affecte pas le prix
obtenu.

Ce n'est pas un mécanisme inédit, et c'est précisément l'intérêt. C'est le design de l'enchère
de clôture qui fixe les prix de référence officiels des grandes bourses, celui des batches de
CoW Protocol, et celui de la littérature Budish–Cramton–Shim sur les enchères par lots
fréquentes. C'est aussi nettement moins cher sur gcEVM, l'appariement s'amortissant sur
l'enchère au lieu de tourner à chaque ordre.

Le mécanisme porte une propriété incitative qui mérite d'être explicitée : à prix uniforme,
biaiser sa limite met surtout l'exécution en péril sans améliorer le prix obtenu. Annoncer sa
vraie valorisation est approximativement optimal. Cette propriété vient du format d'enchère,
pas d'une heuristique dans le code des agents — c'est ce qui rend la couche du §5 lisible
plutôt qu'adversariale.

## 5. La couche agents

Trois desks opèrent comme agents autonomes. Chacun porte un **mandat privé** — taille cible,
prix de réserve, préférence d'échelonnement — qui ne quitte jamais son propre processus. La
stratégie est déterministe, sans appel de modèle : une exécution est reproductible et chaque
chiffre qu'elle produit est vérifiable indépendamment, ce qui est une exigence de vérification
et non un choix esthétique.

Avant de s'engager, les desks échangent des indications d'intérêt chiffrées via le
`PrivateMessaging` de COTI : sens et taille, délibérément aucun prix, lisibles seulement par
le destinataire. La couche de messagerie plafonne les charges utiles à 24 octets par bloc, ce
que l'encodage des IOI respecte (`IOI:B:70`).

Puisque l'enchère rend déjà l'annonce sincère quasi optimale, le RFQ n'est pas une négociation
de prix. Ce qu'il détermine, c'est **s'il faut engager du capital du tout** :

```
engagé = clamp( intérêt opposé visible, plancher de sondage, cible propre )
```

Déposer du collatéral contre un intérêt de contrepartie qui n'existe pas est un pur coût de
capital. Dans l'exécution vérifiée ci-dessous, Atlas vise 70, observe 65 d'offre adverse,
engage 65, et immobilise 6 639 unités de quote au lieu de 7 150 — 511 unités libérées, sans
réduction d'exécution, puisque les 5 non appariés n'allaient pas s'échanger. Un plancher de
sondage empêche la règle de s'effondrer à zéro quand la boîte de réception est vide.

L'IOI doit être chiffré pour que la règle soit sûre. Diffuser « j'ai besoin d'acheter 70 » en
clair revient à instruire le marché de se repricer contre vous.

`PrivateMessaging` rémunère chaque desk au prorata des cellules chiffrées qu'il a stockées : le
protocole finance la négociation confidentielle dont le mécanisme dépend.

## 6. Une exécution vérifiée

Ce qui suit est une exécution unique de `npm run agents` sur le testnet COTI. Chaque valeur a
été produite par le système en fonctionnement et confrontée à `scripts/agents/reference.ts`,
implémentation indépendante en clair du même mécanisme.

**Négociation.** Six IOI chiffrés, 3,12M de gas. Chaque desk dimensionne ensuite :

```
Atlas     boîte : BUY 20, SELL 65   → cible 70, voit 65 d'offre, engage 65
Borealis  boîte : BUY 70, SELL 65   → engage ses 20 en totalité
Cygnus    boîte : BUY 70, BUY 20    → engage ses 65 en totalité
```

**Soumission.** Six ordres scellés, ~2,8M de gas chacun. Publiquement énumérables,
individuellement illisibles. Collatéral verrouillé sous mux, les deux jambes déplacées.

**Appariement.** La fenêtre se ferme ; l'appariement est déclenché sans permission.

```
prix 101, volume apparié 65, 13 130 009 de gas
```

Ces deux valeurs deviennent publiques. Tout ce qui les a produites reste scellé.

**Allocation.** Chaque trader déchiffre exactement une valeur — sa propre exécution :

```
Atlas    ordre 1 → 37      Cygnus  ordre 1 → 20
Atlas    ordre 2 → 28      Cygnus  ordre 2 → 35
Borealis ordre   →  0      Cygnus  ordre 3 → 10
```

Les six correspondent au moteur de référence. La limite de Borealis était sous 101 : il n'a
pas traité et a été intégralement remboursé ; son ordre reste scellé définitivement. **Un
ordre non apparié ne divulgue rien, jamais** — ce qui inverse le profil de fuite habituel,
puisque sur un venue transparent les ordres en attente non exécutés sont précisément ce qui
révèle l'intention.

La confidentialité a été mesurée, non affirmée. Cygnus a tenté de déchiffrer l'exécution de 37
d'Atlas et a obtenu `3.3383808768725014e+38`. La matrice de visibilité complète :

```
aucune clé détenue      lit 0 ordre sur 6
clé d'Atlas             lit 2 sur 6   (exactement les deux siens)
clé de Borealis         lit 1 sur 6   (exactement le sien)
clé de Cygnus           lit 3 sur 6   (exactement les trois siens)
```

Chaque clé lit précisément ses propres lignes.

**Règlement.** En mode pull, en PrivateERC20, montants chiffrés afin que les soldes ne
divulguent pas les positions :

```
Atlas    +65 base / −6 565 quote
Cygnus   −65 base / +6 565 quote
Borealis  0 / 0   (non exécuté, intégralement remboursé)
```

Collatéral entré égal versement sorti, dans les deux jetons, exactement. Chaque desk a ensuite
encaissé 0,0167 COTI de récompense pour les cellules chiffrées stockées.

## 7. Surface de divulgation

| Public | Chiffré définitivement |
|---|---|
| Qu'une adresse a soumis un ordre, et quand | Le sens (achat/vente) |
| Le prix d'équilibre de l'enchère | Le prix limite |
| Le volume total apparié | La taille de l'ordre |
| Que le règlement a eu lieu | L'exécution individuelle |
| La grille de prix et tout le code du contrat | **Tout des ordres non appariés** |

Un bit supplémentaire fuit par construction : une soumission rejetée révèle qu'elle était hors
bornes (§4). Rien d'autre ne franchit la frontière.

La découverte de prix est un bien public ; les entrées qui la produisent ne le sont pas. Sable
sépare les deux.

## 8. Contraintes d'ingénierie

### L'obliviousness, et une primitive inversée

Toute conditionnelle devient un `mux`. Conséquence : la correction de tout le noyau repose sur
une primitive unique — et cette primitive se comporte à l'inverse de la convention :

```
MpcCore.mux(bit, a, b) == bit ? b : a
```

Les arguments sont de fait transposés par rapport à tout ternaire d'usage courant. Ce n'est
documenté nulle part, et c'est invisible depuis le code Solidity puisque l'opération délègue à
un précompilé.

Le mode de défaillance est du genre dangereux. Inversé, le noyau accumule exactement les ordres
qui ne devaient pas participer, produit un prix d'équilibre bien formé et plausible, et ne lève
aucune erreur — puisque toutes les valeurs en jeu sont chiffrées, il n'y a rien à inspecter, à
journaliser ou sur quoi asserter. Notre premier noyau avait ce bug.

Ce qui l'a attrapé est une décision méthodologique prise avant toute mesure : construire un
petit carnet à la main, dériver sur papier le prix et l'allocation corrects, et refuser toute
confiance à l'implémentation jusqu'à ce qu'elle reproduise cette réponse exactement. **En
calcul chiffré, un test dont on connaît la réponse d'avance domine n'importe quelle relecture
de code.** L'enseignement s'est généralisé en `reference.ts` (§13) et est consigné en note de
danger dans l'en-tête du contrat, puisqu'il cassera silencieusement quiconque bâtira sur la
même primitive.

### Le coût est concentré à la frontière des domaines, pas dans l'arithmétique

Chaque opération a été mesurée différentiellement avant que la conception ne soit figée. Le
résultat a inversé nos a priori :

| Opération | Gas |
|---|---|
| Comparer deux valeurs chiffrées | 9 917 |
| Addition / mux / min | ~13 000 |
| Multiplication / division | ~34 000 |
| **`onBoard` / `offBoard` / `validateCiphertext`** | **~48 000** |

L'arithmétique garbled est quasi gratuite. Franchir la frontière entre stockage et calcul coûte
environ 4× une opération de calcul. La règle de conception en découle directement :
**minimiser les franchissements, calculer librement.** Les handles garbled restent valides
toute la transaction : un ordre onboardé une fois se réutilise à chaque phase de l'appariement.

Restructurer le noyau pour onboarder chaque ordre une seule fois au lieu d'à chaque usage l'a
rendu ~2,4× moins cher. Une passe ultérieure a retrouvé la même économie au règlement, le
réduisant de 37 %. Les deux ont été *prédites depuis le tableau puis confirmées par la mesure*,
à 0,2 % près — et c'est là le résultat utile : la surface de coût de cette plateforme est
suffisamment prévisible pour être conçue analytiquement.

La conséquence de second ordre façonne l'architecture de règlement. Un transfert PrivateERC20
256 bits coûte ~1,2M de gas contre ~13k pour une opération garbled 64 bits. **Ce sont les
transferts de jetons chiffrés qui dominent le système, pas le moteur d'appariement
confidentiel.** Le règlement en mode pull en est la réponse directe : l'appariement reste à
coût fixe et chaque desk paie son propre transfert.

## 9. Modèle de coût et capacité

Ajustement par moindres carrés sur la courbe d'appariement mesurée :

```
gas(ordres, niveaux) = 132 064 + 164 081·ordres + 103 275·ordres·niveaux + 52 278·niveaux
```

Résidu contre les mesures réelles : 0,6 %. Le terme bilinéaire est le noyau proprement dit —
une passe sur chaque ordre à chaque niveau de prix — et son coefficient est la règle de
franchissement du §8 rendue visible dans une régression.

Mesuré, sur testnet :

| Action | Gas | Part d'un bloc de 120M |
|---|---|---|
| `submitOrder` | ~2,8M | 2 % |
| Six IOI chiffrés | 3,1M | 3 % |
| `clear`, 6 ordres × 12 niveaux | 13,13M | 11 % |
| `claim` | 1,4M – 4,0M | 1–3 % |
| `rescue` | ~0,5M par ordre | <1 % |

Face à la limite de 120M de gas par bloc, **le modèle** place le plafond autour de 48 ordres à
12 niveaux de prix. Le modèle, pas une mesure : la plus grande configuration que nous avons
appariée et mesurée on-chain est le batch 6×12 ci-dessus. Au-delà, la capacité est une
extrapolation depuis un ajustement à 0,6 % de résidu, et c'est signalé comme tel partout où
elle apparaît.

Les deux termes du modèle sont actionnables dans la même direction. Réduire les niveaux de prix
est l'axe le moins cher — la grille est publique et peut être resserrée autour d'un prix de
référence sans rien divulguer — et le terme linéaire en ordres est ce qui fait du batch, plutôt
que de l'appariement continu, la bonne structure pour cette plateforme.

## 10. Confinement des défaillances

L'appariement est l'opération la plus coûteuse du système, et `currentBatch` n'avance qu'en son
sein. Une enchère impossible à apparier piégerait tout le collatéral qu'elle détient *et*
empêcherait toute enchère future de s'ouvrir. Une seule enchère bloquée mettrait fin au marché,
définitivement.

`rescue(count)` est le confinement. Après un délai borné inférieurement par la fenêtre
d'engagement, **n'importe quelle** adresse peut abandonner une enchère non réglée et libérer
chaque dépôt intact. C'est chunké, pour qu'aucune enchère ne soit trop grosse à dénouer — une
sortie de secours qui pourrait échouer de la même manière que l'opération qu'elle secourt n'est
pas une sortie de secours. À l'achèvement, elle marque l'enchère réglée avec prix et volume à
zéro et avance `currentBatch`, levant le gel.

Éprouvée de bout en bout dans `scripts/test-rescue.ts`, contre un carnet qui aurait croisé :

- rejetée pendant que la fenêtre d'engagement était ouverte ;
- rejetée à nouveau après la fenêtre mais avant le délai de secours ;
- dénouée en deux tranches appelées par deux adresses différentes, démontrant l'absence de
  permission ;
- les trois participants remboursés à un écart de exactement zéro dans les deux jetons ;
- une enchère réglée ne peut pas être secourue deux fois ;
- un nouvel ordre accepté immédiatement après, prouvant que le gel est levé.

Le délai est généreux par choix. Un secours prématuré annule une enchère qui aurait pu
s'apparier, ce qui fait de ce paramètre une surface de nuisance plutôt que de vol — le
compromis est énoncé dans l'en-tête du test pour ne pas être réajusté silencieusement.

## 11. Pourquoi cela exige du MPC et non des preuves à divulgation nulle

L'essentiel des travaux de confidentialité dans ce domaine utilise des preuves
zero-knowledge, qui résolvent un problème adjacent mais strictement plus facile : prouver un
énoncé sur *ses propres* données privées.

Un prix d'équilibre est une fonction des ordres privés **de tout le monde, conjointement**.
Aucun participant ne peut le calculer : il lui faudrait les secrets de tous les autres. Et la
partie à qui l'on déléguerait normalement ce calcul est précisément celle qui ne doit pas
apprendre les entrées. Une preuve ZK peut attester qu'un appariement correct a eu lieu ; elle
ne peut pas en produire un sans que quelqu'un ait d'abord détenu tout le carnet en clair.

Cela exige du calcul sur des données détenues par des parties qui se méfient mutuellement,
c'est-à-dire du calcul multipartite sécurisé — une primitive différente, avec un profil de coût
différent. Jusqu'à ce que le MPC devienne assez rapide pour tourner au sein d'une exécution
EVM, ce mécanisme n'avait aucune voie d'implémentation.

C'est en ce sens que Sable n'est pas la version privée d'un produit existant. C'est un
mécanisme dont l'implémentation était bloquée par la cryptographie sous-jacente, non par
l'effort d'ingénierie.

## 12. Applications

L'usage immédiat est celui construit ici : institutions et agents autonomes exécutant de la
taille sans payer le coût d'être observés.

Ce qui se généralise, c'est la primitive en dessous — un mécanisme dont les entrées restent
privées à leurs propriétaires et dont la sortie est un bien public.

**Les enchères sous pli scellé.** Marchés publics, fréquences, crédits carbone, art. Partout où
les enchérisseurs biaisent aujourd'hui parce que révéler une valorisation réelle est coûteux,
et où l'organisateur est un tiers de confiance par nécessité plutôt que par conception.

**Les marchés entre agents.** La stratégie d'un agent autonome est sa valeur économique, et sur
un registre transparent chaque action qu'il pose publie cette stratégie de façon incrémentale.
La confidentialité n'est pas une fonctionnalité du commerce entre agents, c'en est la condition
préalable. Les trois desks de Sable en sont une instance opérationnelle : ils négocient,
dimensionnent, s'engagent, apparient et règlent sans humain dans la boucle et sans divulguer
de mandat.

**La découverte de prix sans divulgation.** Un prix de référence public et exploitable, calculé
depuis des entrées qui restent privées, se généralise bien au-delà du trading — à tout cadre où
un agrégat a de la valeur et où ses constituants sont sensibles.

## 13. Vérification

Le calcul chiffré ne peut pas être inspecté pendant son exécution. Les assertions sur valeurs
intermédiaires sont indisponibles, le tracing ne révèle rien, et le mode de défaillance qui
compte est une réponse fausse mais plausible, pas un revert. La méthodologie en découle.

**Une seconde implémentation indépendante.** `scripts/agents/reference.ts` implémente le même
mécanisme en TypeScript, en clair, y compris le `>` strict de l'argmax pour que la résolution
des égalités corresponde exactement. Le marché chiffré y est confronté à chaque exécution. Les
valeurs attendues sont *dérivées* plutôt que codées en dur, si bien que l'oracle reste correct
quand les paramètres changent — c'est ce qui a permis de valider la correction du prorata sur
un carnet déséquilibré, et non seulement sur le carnet équilibré contre lequel elle avait été
conçue.

**Invariants assertés on-chain, à chaque exécution.** Les exécutions totalisent le volume
apparié des deux côtés ; collatéral entré égal versement sorti dans les deux jetons ; aucun
ordre suréxécuté ; un desk tentant de déchiffrer l'exécution d'un autre reçoit du bruit.

Deux scénarios complets, de bout en bout :

| | Carnet équilibré | Carnet déséquilibré |
|---|---|---|
| Prix d'équilibre | 101 | 101 |
| Volume apparié | 65 | 85 |
| Exécutions individuelles | les six exactes | les six exactes, rationnement appliqué |
| Conservation | les deux côtés exactement | les deux jetons exactement |
| Deltas de règlement | exacts pour les trois desks | exacts pour les trois desks |
| Confidentialité | chaque clé ne lit que ses lignes | chaque clé ne lit que ses lignes |

Une note méthodologique mérite d'être consignée, car le cas s'est répété. Deux défauts du
frontend — la lecture de l'enchère vide post-appariement, et l'époque de récompense dérivée
comme `currentEpoch − 1` — ont été trouvés en exécutant le système, pas en le relisant. Les
deux étaient dans du code qui se relisait comme manifestement correct. Sur cette plateforme,
l'exécution est le seul oracle fiable.

## 14. Exécution

Testnet uniquement, aucune valeur réelle en jeu à aucun moment.

```bash
npm install
npm run check                  # mécanisme + moteur de référence, hors ligne, sans gas
npx hardhat compile
npm run wallet                 # financer l'adresse affichée gratuitement sur faucet.coti.io
```

L'exécution des agents est découpée en étapes, la fenêtre d'engagement et l'époque de
récompense étant des échéances en temps réel ; chaque étape est reprenable séparément :

```bash
STAGE=setup   npm run agents   # jetons, mint, canal RFQ, le cross, approbations
STAGE=rfq     npm run agents   # indications d'intérêt chiffrées
STAGE=submit  npm run agents   # les desks lisent leur boîte, dimensionnent, scellent
STAGE=clear   npm run agents   # attend la fenêtre, apparie, vérifie contre la référence
STAGE=claim   npm run agents   # règle, vérifie conservation, confidentialité, capital libéré
STAGE=rewards npm run agents   # encaisse les récompenses de messagerie de l'époque close
```

`npm run e2e` sollicite le contrat directement, sans la couche agents.

Le terminal en lecture seule :

```bash
npm run frontend:config        # écrit frontend/.env.local (adresses + clés des desks)
cd frontend && npm install && npm run dev
```

Il s'ouvre sur le carnet complet, chaque champ rendu comme un bloc plein, parce que c'est ce
qui est réellement stocké. Déverrouiller la clé d'un desk résout ses lignes en chiffres tandis
que toutes les autres restent opaques. L'interface ne retient rien — elle affiche l'état
fidèlement.

Les clés vivent dans `.env` et `frontend/.env.local`, tous deux gitignorés. Clés de testnet
exclusivement.

## 15. Dépôt

```
contracts/SableCross.sol         le marché : enchères, collatéral, appariement, allocation, claim
contracts/GasSpike.sol           le noyau instrumenté pour la mesure
contracts/test/TestToken.sol     PrivateERC20 à mint ouvert, pour les exécutions testnet
contracts/test/DeskMessaging.sol PrivateMessaging déployable — le canal RFQ

scripts/agents/desks.ts          les trois mandats privés et la grille de marché
scripts/agents/strategy.ts       couche de décision déterministe, pure et testable
scripts/agents/reference.ts      moteur d'appariement en clair — l'oracle du contrat
scripts/agents/desk.ts           le comportement on-chain d'un desk : RFQ, submit, claim
scripts/run-agents.ts            l'exécution complète des agents
scripts/cross-e2e.ts             test contrat à trois traders, avec assertions
scripts/test-rescue.ts           la sortie de secours, éprouvée de bout en bout
scripts/stress-max-orders.ts     le marché à sa capacité configurée
scripts/spike-gas.ts             courbe de gas + harnais de correction

frontend/                        terminal en lecture seule — le carnet scellé, en direct

SPIKE.md                         comment chaque chiffre de gas ici a été mesuré
README.md                        point d'entrée technique
```

---

*Construit pour le [COTI Vibe Code Challenge — Web 4 Agent Edition](https://stay.coti.io/vibe-coding/).
Tourne sur le testnet public de COTI (chaîne 7082400). Licence MIT.*
