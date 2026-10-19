export function matchingBooks(books,query=''){
  const terms=String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return books.filter(book=>{
    if(!book||typeof book.title!=='string')return false;
    const title=book.title.toLocaleLowerCase();
    return terms.every(term=>title.includes(term));
  });
}
