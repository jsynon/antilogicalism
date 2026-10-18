"""Read-only experiment: can local TF-IDF + latent semantic indexing improve
source page recall without extra public AI calls? This is NOT deployed code.
Download only the existing public v47 shards, score exact page ids.
"""
import gzip
import json
import re
import urllib.request
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.decomposition import TruncatedSVD
from sklearn.preprocessing import normalize

ROOT = "https://jsynon.github.io/antilogicalism-library-data/data-v47/"
CASES = [
("Dostoevsky",114,
 "Raskolnikov justify murder and novel challenge his reasoning",
 ["Raskolnikov justify murder", "novel challenge his reasoning"]),
("Aristotle",7,
 "moral virtue practical wisdom happiness eudaimonia fit together",
 ["moral virtue practical wisdom", "happiness eudaimonia"]),
("Darwin",529,
 "natural selection operate inherited variation struggle existence",
 ["natural selection operate", "inherited variation struggle existence"]),
("Thucydides",152,
 "underlying causes Peloponnesian War differ immediate disputes",
 ["underlying causes Peloponnesian War", "immediate disputes preceding war"]),
]
def source(book_id):
    with urllib.request.urlopen(ROOT + f"book-{book_id}.json.gz", timeout=60) as r:
        raw = r.read()
    value = json.loads(gzip.decompress(raw).decode("utf-8"))
    return sorted((p for p in value["pages"] if p.get("text") and len(p["text"])>60),
        key=lambda p:p["page"])
def ranked_pages(pages, full, clauses):
    vectorizer=TfidfVectorizer(stop_words="english",max_df=0.93,min_df=2,
       ngram_range=(1,2),max_features=38000,sublinear_tf=True,norm="l2")
    texts=[p["text"] for p in pages]
    X=vectorizer.fit_transform(texts)
    k=min(96,X.shape[0]-1,X.shape[1]-1)
    if k<5:return {}
    svd=TruncatedSVD(n_components=k,n_iter=5,random_state=42)
    dense=normalize(svd.fit_transform(X))
    queries=[full]+clauses
    raw_query=vectorizer.transform(queries)
    projected=normalize(svd.transform(raw_query))
    lexical=(X@raw_query.T).toarray()
    semantic=dense@projected.T
    results={}
    for i,q in enumerate(queries):
        score=0.5*lexical[:,i]+0.5*semantic[:,i]
        ids=np.argsort(-score)[:14]
        results[q]=[(int(pages[j]["page"]),round(float(score[j]),3),
          re.sub(r"\s+"," ",pages[j]["text"])[:130]) for j in ids]
    # Combined facet-coverage ranking: maximum support for each clause
    if len(clauses)>1:
        a=semantic[:,1]+lexical[:,1]
        b=semantic[:,2]+lexical[:,2]
        p=np.argsort(-a)[:30]
        q=np.argsort(-b)[:30]
        combos=sorted(((float(a[i]+b[j]-0.5*abs(a[j]-b[j])),i,j)
              for i in p for j in q if i!=j),reverse=True)
        results["facet pair"]=[(pages[i]["page"],pages[j]["page"],round(score,3))
               for score,i,j in combos[:5]]
    return results

for label,book,q,clauses in CASES:
    pages=source(book)
    print("\n===",label,"===","pages",len(pages))
    for term,rows in ranked_pages(pages,q,clauses).items():
        print("QUERY",term)
        for entry in rows[:9]:print(" ",entry)
