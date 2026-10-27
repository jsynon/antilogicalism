const collator=new Intl.Collator('en',{numeric:true,sensitivity:'base'});
const AUTHOR_SEPARATOR=/\s+[—–-]\s+/;

function splitTitle(title){
  const parts=String(title||'').trim().split(AUTHOR_SEPARATOR);
  return parts.length>1?{work:parts.slice(0,-1).join(' — '),author:parts.at(-1).trim()}:
    {work:String(title||'').trim(),author:''};
}
function normalized(value){
  return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .toLocaleLowerCase('en').trim();
}
function authorName(title){
  let author=splitTitle(title).author;
  author=author.replace(/^(?:(?:edited|compiled|translated|selected|introduced)\s+by|by)\s+/i,'');
  author=author.split(/[,;]\s*(?:(?:translated|edited|compiled|introduced)\s+by|trans\.?|ed\.?)\b/i)[0];
  return author.replace(/\s+(?:and others|et al\.?)$/i,'').trim();
}
function surname(name){
  const words=String(name||'').replace(/^(?:the|saint|st\.)\s+/i,'').split(/\s+/).filter(Boolean);
  if(!words.length)return 'zzzzzz';
  const last=words.at(-1).replace(/[^\p{L}\p{N}'’-]/gu,'');
  const particles=new Set(['da','de','del','della','di','du','la','le','van','von','bin','al']);
  return particles.has((words.at(-2)||'').toLocaleLowerCase('en'))?
    words.at(-2)+' '+last:last;
}
function volumeNumber(token){
  if(/^\d+$/.test(token))return Number(token);
  const letters=token.toUpperCase();
  if(!/^(?=[IVXLCDM]+$)M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/.test(letters))return null;
  const values={I:1,V:5,X:10,L:50,C:100,D:500,M:1000};
  let value=0;
  for(let i=0;i<letters.length;i++){
    const current=values[letters[i]],next=values[letters[i+1]]||0;
    value+=current<next?-current:current;
  }
  return value;
}
function collectionVolume(title){
  // Strip the author suffix before reading series labels, since some volumes
  // credit different translators or contributors in the selector.
  const work=splitTitle(title).work;
  const known=[
    {name:'Harvard Classics',pattern:/\bHarvard Classics\b/i},
    {name:'Sacred Books of the East',pattern:/\bSacred Books of the East\b/i}
  ];
  for(const series of known){
    const label=series.pattern.exec(work);
    if(!label)continue;
    const volume=work.slice(label.index+label[0].length)
      .match(/\b(?:volume|vol\.?)\s*(\d+|[ivxlcdm]+)\b/i);
    if(volume){
      const number=volumeNumber(volume[1]);
      if(number!==null)return {name:series.name,volume:number};
    }
  }
  // Also group ordinary multi-volume and multi-book titles such as
  // "Collected Works of X, Volume II" or "Against Heresies, Book III".
  const match=work.match(/^(.*?)\s*,?\s+(?:volume|vol\.?|book|part)\s*(\d+|[ivxlcdm]+)\b/i);
  if(!match)return null;
  const name=match[1].replace(/[,:;–—-]+$/,'').trim();
  const volume=volumeNumber(match[2]);
  return name&&volume!==null?{name,volume}:null;
}
function compareBookTitle(a,b){
  return collator.compare(a.title,b.title)||collator.compare(a.id,b.id);
}

export function sortBooksForSelector(books){
  const groups=new Map(),entries=[];
  for(const book of books){
    const series=collectionVolume(book.title);
    if(!series){entries.push({kind:'book',book,author:authorName(book.title)});continue;}
    const key=normalized(series.name);
    if(!groups.has(key))groups.set(key,{kind:'collection',name:series.name,books:[]});
    groups.get(key).books.push({...book,collectionVolume:series.volume});
  }
  for(const group of groups.values()){
    group.books.sort((a,b)=>a.collectionVolume-b.collectionVolume||compareBookTitle(a,b));
    const first=group.books[0];
    group.author=authorName(first.title)||group.name;
    entries.push(group);
  }
  entries.sort((a,b)=>{
    const surnameOrder=collator.compare(surname(a.author),surname(b.author));
    if(surnameOrder)return surnameOrder;
    const authorOrder=collator.compare(a.author,b.author);
    if(authorOrder)return authorOrder;
    if(a.kind==='collection'&&b.kind==='collection')
      return collator.compare(a.name,b.name);
    if(a.kind!==b.kind)return a.kind==='collection'?-1:1;
    return compareBookTitle(a.book,b.book);
  });
  return entries.flatMap(entry=>entry.kind==='collection'?entry.books:entry.book);
}

export function filterBooksByText(books,query){
  const term=normalized(query);
  if(!term)return [...books];
  return books.filter(book=>normalized(book.title).includes(term)||
    normalized(authorName(book.title)).includes(term));
}
