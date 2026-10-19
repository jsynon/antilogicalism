import assert from 'node:assert/strict';
import {test} from 'node:test';
import {matchingBooks} from './book-filter.mjs';

const books=[
 {id:'7',title:'Nicomachean Ethics — Aristotle'},
 {id:'114',title:'Crime and Punishment — Fyodor Dostoevsky'},
 {id:'152',title:'History of the Peloponnesian War — Thucydides'},
 {id:'529',title:'On the Origin of Species — Charles Darwin'}
];

test('book finder matches title and author terms without regard to case',()=>{
 assert.deepEqual(matchingBooks(books,'ARISTOTLE ethics'),[books[0]]);
 assert.deepEqual(matchingBooks(books,'charles darwin'),[books[3]]);
});

test('empty or whitespace-only book finder keeps every pilot book',()=>{
 assert.deepEqual(matchingBooks(books,''),books);
 assert.deepEqual(matchingBooks(books,'   '),books);
});

test('book finder returns no books when the query has no matching title or author',()=>{
 assert.deepEqual(matchingBooks(books,'Kant'),[]);
});
