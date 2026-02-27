IMDb Rating Predictor
Dette projekt bruger Machine Learning til at analysere og forudsige IMDb-ratings for verdens 1000 bedste film. Ved at kigge på data som budget og spilletid forsøger programmet at finde mønstre i, hvad der gør en film succesfuld.

🚀 Hvad kan programmet?
Programmet indlæser et datasæt og bruger to forskellige matematiske metoder til at forstå tallene:

Regression: Tegner en linje gennem dataene for at vise den generelle tendens (f.eks. om længere film får bedre ratings).

K-Nearest Neighbors (KNN): Gætter en films rating ved at sammenligne den med de 7 film i datasættet, der minder mest om den.

🛠 Sådan bruger du det
Download eller clone projektet fra GitHub.

Åbn index.html i din browser (hvis du bruger VS Code, så brug "Live Server").

Vælg hvilke data du vil se på akserne (f.eks. "Runtime" vs "IMDB_Rating").

Se hvordan trendlinjen og KNN-modellen reagerer på dine valg.

📁 Projektets indhold
index.js: Selve logikken, der renser data og laver de matematiske beregninger.

assets/imdb_top_1000.csv: Datasættet med de 1000 film.

index.html: Brugerfladen med grafer og kontrolpanel.
