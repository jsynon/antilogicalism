(() => {
  const host = document.getElementById('library-directory');
  if (!host) return;
  const script = document.currentScript;
  const catalogUrl = (script && script.dataset.catalog) || './library-catalog.json';
  const labels = {
    authors: 'Browse by Author', subjects: 'Browse by Subject', all: 'All Books',
    uncategorized: 'Not yet classified', collective: 'Collected, Anonymous & Traditional Works'
  };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
  const surnameFor = name => {
    if (/^Pliny the (Elder|Younger)$/i.test(name)) return 'Pliny';
    const words=String(name||'').trim().split(/\s+/);
    if(words.length<2)return words[0]||'';
    const particles=new Set(['al','al-','de','del','di','du','la','le','van','von','der','of']);
    return particles.has(words[words.length-2].toLowerCase())?words.slice(-2).join(' '):words[words.length-1];
  };

  host.innerHTML = `
    <section class="ald-browser" aria-labelledby="ald-title">
      <header class="ald-browser-head">
        <p class="ald-eyebrow">Library Browsing</p>
        <h2 id="ald-title">Browse by Author or Subject</h2>
        <p class="ald-intro">Explore the catalog by author, subject, or collection. Collected and anonymous works are grouped together.</p>
      </header>
      <div class="ald-mode" role="tablist" aria-label="Browse catalog">
        <button type="button" role="tab" aria-selected="true" data-mode="authors">${labels.authors}</button>
        <button type="button" role="tab" aria-selected="false" data-mode="subjects">${labels.subjects}</button>
      </div>
      <div class="ald-controls">
        <label class="ald-search-label" for="ald-query">Find a book or author</label>
        <input id="ald-query" type="search" placeholder="Search titles and author names" autocomplete="off">
        <div class="ald-filter-wrap"><label for="ald-filter">Browse</label><select id="ald-filter"><option value="all">All Books</option></select></div>
      </div>
      <p class="ald-count" aria-live="polite"></p>
      <div class="ald-results" id="ald-results"></div>
      <p class="ald-note">Book links open the digitized source in a new tab. Subject groupings are a starting point; works without a confident catalog classification remain available under “Not yet classified.”</p>
    </section>`;

  const style = document.createElement('style');
  style.textContent = `
  .ald-browser{--ald-ink:#302b25;--ald-muted:#746b60;--ald-rule:#d9d0c3;--ald-paper:#faf8f3;--ald-accent:#73563b;color:var(--ald-ink);margin:2rem 0;padding:clamp(1rem,3vw,2rem);border:1px solid var(--ald-rule);background:var(--ald-paper);font-family:inherit}
  .ald-browser *{box-sizing:border-box}.ald-browser-head{margin:0 0 1.25rem}.ald-eyebrow{margin:0 0 .25rem;text-transform:uppercase;letter-spacing:.13em;font-size:.72rem;color:var(--ald-muted)}
  .ald-browser h2{margin:.1rem 0 .45rem;font-family:Georgia,serif;font-size:clamp(1.8rem,3vw,2.2rem);font-weight:normal;line-height:1.2}.ald-intro{margin:0;color:var(--ald-muted);max-width:58ch}
  .ald-mode{display:flex;gap:.45rem;border-bottom:1px solid var(--ald-rule);margin:1.2rem 0 1rem}.ald-mode button{font:inherit;color:var(--ald-ink);background:transparent;border:0;border-bottom:3px solid transparent;padding:.65rem .8rem;cursor:pointer}.ald-mode button[aria-selected="true"]{border-color:var(--ald-accent);font-weight:600}
  .ald-controls{display:grid;grid-template-columns:minmax(200px,2fr) minmax(190px,1fr);gap:.35rem 1rem;align-items:end}.ald-search-label,.ald-filter-wrap label{font-size:.85rem;color:var(--ald-muted)}.ald-search-label{grid-column:1}.ald-controls input,.ald-filter-wrap select{width:100%;min-height:42px;padding:.55rem .7rem;border:1px solid #bdb3a5;background:#fff;color:var(--ald-ink);font:inherit}.ald-filter-wrap{display:grid;gap:.35rem}.ald-count{font-size:.9rem;color:var(--ald-muted);margin:1rem 0 .6rem;border-bottom:1px solid var(--ald-rule);padding-bottom:.6rem}
  .ald-author-group{margin:1rem 0}.ald-author-results>.ald-author-group+.ald-author-group{margin-top:1.25rem;padding-top:.8rem;border-top:1px solid var(--ald-rule)}.ald-author-group h3{font-family:Georgia,serif;font-size:1.7rem!important;font-style:normal!important;font-weight:600;line-height:1.3;margin:.15rem 0 .4rem;padding:0}.ald-author-group h4{font-family:Georgia,serif;font-size:1.18rem;font-weight:600;margin:1rem 0 .35rem;color:var(--ald-accent);padding-bottom:.25rem}.ald-collection-group+.ald-collection-group{margin-top:.75rem;padding-top:.5rem;border-top:1px solid var(--ald-rule)}.ald-book-list{list-style:none;margin:0;padding:0}.ald-book-list li{padding:.35rem 0}.ald-book-list a{color:var(--ald-accent);text-decoration:underline;text-underline-offset:2px}.ald-book-list a:hover,.ald-book-list a:focus{text-decoration-thickness:2px}.ald-empty{color:var(--ald-muted);padding:1rem 0}.ald-note{font-size:.82rem;color:var(--ald-muted);margin:1.4rem 0 0}.ald-alpha{display:flex;flex-wrap:wrap;gap:.25rem;margin:.5rem 0 1rem}.ald-alpha button{border:1px solid var(--ald-rule);background:white;color:var(--ald-accent);padding:.25rem .5rem;cursor:pointer}.ald-alpha button[aria-pressed="true"]{background:var(--ald-accent);color:white}.ald-alpha button:disabled{opacity:.4;cursor:default}.ald-pager{display:flex;align-items:center;justify-content:center;gap:.8rem;margin:1rem 0}.ald-pager button{font:inherit;padding:.4rem .7rem;border:1px solid var(--ald-rule);background:#fff;color:var(--ald-accent);cursor:pointer}.ald-pager button:disabled{opacity:.45;cursor:default}
  @media(max-width:600px){.ald-controls{grid-template-columns:1fr}.ald-search-label{grid-column:auto}.ald-browser{padding:1rem}.ald-mode button{padding:.55rem .4rem;font-size:.92rem}}
  `;
  document.head.appendChild(style);

  Promise.resolve(window.ANTILOGICALISM_LIBRARY_CATALOG || fetch(catalogUrl).then(r => { if (!r.ok) throw new Error('Catalog could not be loaded'); return r.json(); })).then(data => {
    const books = data.books || [];
    const modeButtons = [...host.querySelectorAll('[data-mode]')];
    const query = host.querySelector('#ald-query');
    const filter = host.querySelector('#ald-filter');
    const filterLabel = host.querySelector('.ald-filter-wrap label');
    const count = host.querySelector('.ald-count');
    const results = host.querySelector('#ald-results');
    let mode = 'authors', letter = '', page = 0;
    const perPage = 15, authorGroupsPerPage = 15;
    const subjects = data.subjects || [];

    function options() {
      filterLabel.textContent = mode === 'subjects' ? 'Subject' : 'Collection';
      if (mode === 'subjects') {
        filter.innerHTML = `<option value="all">${labels.all}</option>` + subjects.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('') + `<option value="__unclassified">${labels.uncategorized}</option>`;
        filter.value = 'all';
      } else {
        filter.innerHTML = `<option value="all">${labels.all}</option><option value="__collective">${labels.collective}</option>`;
        filter.value = 'all';
      }
      letter = '';
    }
    function filtered() {
      const q = norm(query.value.trim()), f=filter.value;
      return books.filter(b => {
        const author = b.author || labels.collective;
        const names=(b.authors||[author]).join(' ');
        const matchesQ = !q || norm(b.title).includes(q) || norm(names).includes(q);
        const matchesF = mode === 'subjects'
          ? (f==='all' || (f==='__unclassified' ? !b.subjects.length : b.subjects.includes(f)))
          : (f==='all' || (f==='__collective' ? (b.authorGroup==='collective'||Boolean(b.collection)) : true));
        return matchesQ && matchesF;
      }).sort((a,b) => mode==='authors'
        ? norm(a.sortSurname || a.author).localeCompare(norm(b.sortSurname || b.author)) || norm(a.author).localeCompare(norm(b.author)) || norm(a.title).localeCompare(norm(b.title))
        : norm(a.title).localeCompare(norm(b.title)));
    }
    function render() {
      const list=filtered();
      if (!list.length) { count.textContent=`0 of ${books.length} books`; results.innerHTML='<p class="ald-empty">No books match this search.</p>'; return; }
      if (mode==='subjects') {
        const pages=Math.ceil(list.length/perPage); page=Math.min(page,pages-1);
        const start=page*perPage, visible=list.slice(start,start+perPage);
        count.textContent=`Showing ${start+1}–${Math.min(start+perPage,list.length)} of ${list.length} books (${books.length} total)`;
        results.innerHTML=visible.map(b=>`<div class="ald-author-group"><ul class="ald-book-list"><li>${b.url?`<a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.title)}</a>`:`${esc(b.title)} <span class="ald-note">(link unavailable)</span>`}${b.subjects.length?` <span class="ald-note">· ${esc(b.subjects.join(', '))}</span>`:''}</li></ul></div>`).join('')+pager(pages);
        wirePager();
        return;
      }
      const groups=new Map();
      list.forEach(b=>{const names=(b.authorGroup==='collective'||b.collection)?[labels.collective]:(b.authors||[b.author||labels.collective]);for(const key of new Set(names)){if(!groups.has(key))groups.set(key,[]);groups.get(key).push(b);}});
      const keys=[...groups.keys()].sort((a,b)=>{
        const ac=a===labels.collective,bc=b===labels.collective;if(ac!==bc)return ac?1:-1;
        return norm(surnameFor(a)).localeCompare(norm(surnameFor(b)))||norm(a).localeCompare(norm(b));
      });
      const isCollective=filter.value==='__collective';
      const letters=[...new Set(keys.filter(k=>k!==labels.collective).map(k=>surnameFor(k).charAt(0).toUpperCase()))].sort();
      const alpha=isCollective?'':`<nav class="ald-alpha" aria-label="Author initials">${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(c=>`<button type="button" data-letter="${c}" aria-pressed="${letter===c}" ${letters.includes(c)?'':'disabled'}>${c}</button>`).join('')}<button type="button" data-letter="" aria-pressed="${!letter}">All</button></nav>`;
      const visibleKeys=keys.filter(k=>!letter || (k!==labels.collective && surnameFor(k).toUpperCase().startsWith(letter)));
      const collectiveBooks=isCollective?(groups.get(labels.collective)||[]).slice().sort((a,b)=>(a.collectionOrder??999)-(b.collectionOrder??999)||norm(a.collection||'').localeCompare(norm(b.collection||''))||(a.collectionVolume??Number.MAX_SAFE_INTEGER)-(b.collectionVolume??Number.MAX_SAFE_INTEGER)||norm(a.title).localeCompare(norm(b.title))):[];
      const itemsPerPage=isCollective?perPage:authorGroupsPerPage;
      const pages=Math.ceil((isCollective?collectiveBooks.length:visibleKeys.length)/itemsPerPage); page=Math.min(page,pages-1);
      const start=page*itemsPerPage, pageKeys=isCollective?[labels.collective]:visibleKeys.slice(start,start+itemsPerPage);
      const visibleBookCount=new Set(visibleKeys.flatMap(k=>groups.get(k).map(b=>b.id))).size;
      count.textContent=isCollective?`Showing ${start+1}–${Math.min(start+perPage,collectiveBooks.length)} of ${collectiveBooks.length} collected and anonymous titles`: `${visibleBookCount} books across ${visibleKeys.length} authors; showing authors ${start+1}–${Math.min(start+authorGroupsPerPage,visibleKeys.length)} of ${visibleKeys.length}`;
      const renderBooks=items=>`<ul class="ald-book-list">${items.map(b=>`<li>${b.url?`<a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.workTitle||b.title)}</a>`:`${esc(b.workTitle||b.title)} <span class="ald-note">(link unavailable)</span>`}</li>`).join('')}</ul>`;
      const renderCollective=items=>{
        const collections=new Map();
        items.forEach(b=>{const key=b.collection||'Other Anonymous & Traditional Works';if(!collections.has(key))collections.set(key,[]);collections.get(key).push(b);});
        return [...collections.keys()].sort((a,b)=>{const A=collections.get(a)[0],B=collections.get(b)[0];return (A.collectionOrder??999)-(B.collectionOrder??999)||norm(a).localeCompare(norm(b));}).map(name=>{
          const entries=collections.get(name).sort((a,b)=>{const av=a.collectionVolume??Number.MAX_SAFE_INTEGER,bv=b.collectionVolume??Number.MAX_SAFE_INTEGER;return av-bv||norm(a.title).localeCompare(norm(b.title));});
          return `<section class="ald-collection-group"><h4>${esc(name)}</h4>${renderBooks(entries)}</section>`;
        }).join('');
      };
      const output=pageKeys.map(k=>k===labels.collective?`<section class="ald-author-group ald-collective"><h3>${esc(k)}</h3>${renderCollective(isCollective?collectiveBooks.slice(start,start+perPage):groups.get(k))}</section>`:`<section class="ald-author-group"><h3>${esc(k)}</h3>${renderBooks(groups.get(k).sort((a,b)=>norm(a.title).localeCompare(norm(b.title))))}</section>`).join('');
      results.innerHTML=alpha+`<div class="ald-author-results">${output||'<p class="ald-empty">No authors match this letter.</p>'}</div>`+pager(pages);
      results.querySelectorAll('[data-letter]').forEach(btn=>btn.addEventListener('click',()=>{letter=btn.dataset.letter;page=0;render();}));
      wirePager();
    }
    function pager(pages){return pages>1?`<nav class="ald-pager" aria-label="Catalog pages"><button type="button" data-page="prev" ${page===0?'disabled':''}>Previous</button><span>Page ${page+1} of ${pages}</span><button type="button" data-page="next" ${page>=pages-1?'disabled':''}>Next</button></nav>`:'';}
    function wirePager(){results.querySelectorAll('[data-page]').forEach(btn=>btn.addEventListener('click',()=>{page+=btn.dataset.page==='next'?1:-1;render();}));}
    modeButtons.forEach(btn=>btn.addEventListener('click',()=>{mode=btn.dataset.mode;page=0;modeButtons.forEach(x=>x.setAttribute('aria-selected',String(x===btn)));options();render();}));
    query.addEventListener('input',()=>{page=0;render();});filter.addEventListener('change',()=>{letter='';page=0;render();});options();render();
  }).catch(() => { host.querySelector('.ald-results').innerHTML='<p class="ald-empty">The library catalog could not be loaded. Check that the catalog JSON file is beside this page.</p>'; });
})();
