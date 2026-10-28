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
  const first=String(name||'').split(/\s+(?:and|&)\s+/i)[0]
    .split(/\s*;\s*/)[0].trim();
  if(!first)return 'zzzzzz';
  const commaParts=first.split(',').map(part=>part.trim()).filter(Boolean);
  if(commaParts.length>1)return commaParts[0].split(/\s+/).at(-1);
  const words=first.replace(/[.]/g,'').split(/\s+/).filter(Boolean);
  while(words.length>1&&/^(jr|sr|ii|iii|iv|v)$/i.test(words.at(-1)))words.pop();
  if(!words.length)return 'zzzzzz';
  // File by the final meaningful name: Hippo, Elder, and Spinoza, not
  // the lead-in particles "of", "the", or "de".
  const particles=new Set(['al','bin','da','de','del','della','der','di','du','el','ibn','la','le','of','the','ten','ter','van','von','zu','zum','zur']);
  const meaningful=words.filter(word=>!particles.has(word.toLocaleLowerCase('en')));
  const key=(meaningful.length?meaningful:words).at(-1);
  return key.replace(/^(?:al|el)-/i,'')||key;
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
      if(number!==null)return {name:series.name,volume:number,collection:true};
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
    if(!groups.has(key))groups.set(key,{kind:'collection',name:series.name,books:[],collection:series.collection===true});
    groups.get(key).books.push({...book,collectionVolume:series.volume});
  }
  for(const group of groups.values()){
    group.books.sort((a,b)=>a.collectionVolume-b.collectionVolume||compareBookTitle(a,b));
    const first=group.books[0];
    group.author=group.collection?group.name:(authorName(first.title)||group.name);
    entries.push(group);
  }
  entries.sort((a,b)=>{
    // Keep named collections under their collection name; ordinary books and
    // author-specific series use the author's final meaningful surname.
    const keyA=a.collection?a.name:surname(a.author);
    const keyB=b.collection?b.name:surname(b.author);
    const keyOrder=collator.compare(keyA,keyB);
    if(keyOrder)return keyOrder;
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
