"""Antilogicalism static article publisher. Requires markdown and beautifulsoup4."""
import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import markdown
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent
BASE = '/antilogicalism/'
BLOG = ROOT / 'index' / 'index.html'
PREVIEW = ROOT / '_post-preview'
INDEXER = ROOT / 'scripts' / 'build_search_index.py'


def read(path):
    return path.read_text(encoding='utf-8')


def slugify(value):
    slug = re.sub(r'[^a-z0-9]+', '-', value.lower()).strip('-')
    if not slug:
        raise ValueError('Could not create a URL slug from title')
    return slug


def load_article(source):
    data = source.read_text(encoding='utf-8-sig').strip()
    match = re.match(r'^#\s+(.+)\s*(?:\r?\n|$)', data)
    if not match:
        raise ValueError('Article must begin with a Markdown heading: # Article Title')
    title = match.group(1).strip()
    body = data[match.end():].strip()
    if not body:
        raise ValueError('Article body is empty')
    return title, body


def soup_file(path):
    return BeautifulSoup(read(path), 'html.parser')


def listing(soup):
    node = soup.select_one('ul.lcp_catlist#lcp_instance_0')
    if node is None:
        raise RuntimeError('Blog listing structure changed: lcp_catlist missing')
    return node


def latest_post(blog_soup):
    first = listing(blog_soup).select_one('li > a[href]')
    if not first:
        raise RuntimeError('Cannot locate most recent blog post')
    url = first['href']
    if not url.startswith(BASE) or not url.endswith('/'):
        raise RuntimeError(f'Unexpected blog post URL: {url}')
    relative = url[len(BASE):].strip('/')
    path = ROOT / relative / 'index.html'
    if not path.is_file():
        raise RuntimeError(f'Latest blog article not found: {path}')
    return url, first.get_text(' ', strip=True), path


def nav_link(soup, direction, url, title):
    # Match the WordPress Book Lite navigation containers.
    nav = soup.select_one('#nav-below')
    if nav is None:
        nav = soup.new_tag('nav', id='nav-below', attrs={'class': 'navigation post-navigation'})
        article = soup.select_one('article.post')
        if article is None:
            raise RuntimeError('Cannot insert article navigation')
        article.insert_after(nav)
    section = nav.select_one(f'.nav-{direction}')
    if section is None:
        section = soup.new_tag('div', attrs={'class': f'nav-{direction}'})
        nav.append(section)
    section.clear()
    a = soup.new_tag('a', href=url, rel=('prev' if direction == 'previous' else 'next'))
    a.string = title
    section.append(a)


def build_article(template_path, title, body, date, permalink, prior_url, prior_title):
    soup = soup_file(template_path)
    article = soup.select_one('article.post')
    if article is None:
        raise RuntimeError('Book Lite template article missing')
    heading = article.select_one('h1.entry-title')
    content = article.select_one('div.entry-content')
    if heading is None or content is None:
        raise RuntimeError('Book Lite template title/content missing')
    article['id'] = 'post-new'
    article['class'] = ['post', 'type-post', 'status-publish', 'format-standard', 'hentry', 'category-uncategorized']
    heading.string = title
    content.clear()
    fragment = BeautifulSoup(markdown.markdown(body, extensions=['extra', 'sane_lists']), 'html.parser')
    for child in list(fragment.contents):
        content.append(child)
    for element in article.select('.cats-links, footer.entry-meta'):
        element.decompose()
    meta = article.select_one('header.entry-header .entry-meta')
    if meta:
        span = soup.new_tag('span', attrs={'class': 'cats-links'})
        span.append(' under ')
        a = soup.new_tag('a', href=BASE + 'uncategorized/', rel='category tag')
        a.string = 'Uncategorized'
        span.append(a)
        meta.append(span)
    stamp = article.select_one('time.entry-date')
    if stamp:
        stamp.string = f'{date.strftime("%B")} {date.day}, {date.year}'
        stamp['datetime'] = date.isoformat()
        parent_link = stamp.find_parent('a')
        if parent_link:
            parent_link['href'] = permalink
            parent_link['title'] = date.strftime('%I:%M %p').lstrip('0')
    if soup.title:
        soup.title.string = f'{title} | Antilogicalism'
    # Replace inherited SEO description with a summary of the new article.
    rendered_text = BeautifulSoup(markdown.markdown(body, extensions=['extra', 'sane_lists']), 'html.parser')
    first_paragraph = rendered_text.find('p')
    description = (first_paragraph or rendered_text).get_text(' ', strip=True)
    if len(description) > 160:
        description = description[:157].rsplit(' ', 1)[0].rstrip(' ,.;:') + '...'
    for old_description in soup.select('meta[name="description"]'):
        old_description.decompose()
    if soup.head:
        soup.head.append(soup.new_tag('meta', attrs={'name': 'description', 'content': description}))
    for element in soup.select('link[rel="canonical"], link[rel="amphtml"], meta[property^="og:"], meta[name^="twitter:"]'):
        element.decompose()
    if soup.head:
        soup.head.append(soup.new_tag('link', rel='canonical', href='https://jsynon.github.io' + permalink))
    for nav in soup.select('#nav-above, #nav-below'):
        nav.decompose()
    nav_link(soup, 'previous', prior_url, prior_title)
    return str(soup)


def build_blog(blog_soup, title, body, permalink):
    post_list = listing(blog_soup)
    if any(a.get('href') == permalink for a in post_list.select('a[href]')):
        raise FileExistsError('Post already appears in the Blog listing')
    rendered = BeautifulSoup(markdown.markdown(body, extensions=['extra', 'sane_lists']), 'html.parser')
    para = rendered.find('p')
    plain = para.get_text(' ', strip=True) if para else rendered.get_text(' ', strip=True)
    excerpt = plain[:297].rstrip() + ('...' if len(plain) > 297 else '')
    li = blog_soup.new_tag('li')
    link = blog_soup.new_tag('a', href=permalink)
    link.string = title
    li.append(link)
    div = blog_soup.new_tag('div', attrs={'class': 'lcp_excerpt'})
    p = blog_soup.new_tag('p')
    p.string = excerpt
    div.append(p)
    li.append(div)
    post_list.insert(0, li)
    return str(blog_soup)


def prepare(source, date):
    title, body = load_article(source)
    slug = slugify(title)
    relative = f'{date:%Y/%m/%d}/{slug}'
    permalink = BASE + relative + '/'
    target = ROOT / relative / 'index.html'
    if target.exists():
        raise FileExistsError(f'Article already exists: {target}')
    blog_soup = soup_file(BLOG)
    prior_url, prior_title, prior_path = latest_post(blog_soup)
    html = build_article(prior_path, title, body, date, permalink, prior_url, prior_title)
    blog_html = build_blog(blog_soup, title, body, permalink)
    return dict(title=title, permalink=permalink, relative=relative, article_html=html,
                blog_html=blog_html, previous_path=str(prior_path.relative_to(ROOT)),
                previous_url=prior_url, previous_title=prior_title,
                source_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
                date=date.isoformat())


def preview(source, date):
    result = prepare(source, date)
    if PREVIEW.exists():
        raise FileExistsError(f'Preview folder already exists: {PREVIEW}\n'
                              'Move or delete it before previewing another article.')
    PREVIEW.mkdir(parents=True)
    (PREVIEW / 'index.html').write_text(result['article_html'], encoding='utf-8')
    (PREVIEW / 'blog.html').write_text(result['blog_html'], encoding='utf-8')
    metadata = {k: v for k, v in result.items() if not k.endswith('_html')}
    metadata['source'] = str(source.resolve())
    (PREVIEW / 'manifest.json').write_text(json.dumps(metadata, indent=2), encoding='utf-8')
    print('Article preview:', PREVIEW / 'index.html')
    print('Blog preview:', PREVIEW / 'blog.html')
    print('Permalink:', result['permalink'])
    print('No published website files were changed.')


def publish(source):
    manifest_path = PREVIEW / 'manifest.json'
    if not manifest_path.is_file():
        raise RuntimeError('No preview manifest. Run preview first.')
    manifest = json.loads(read(manifest_path))
    if Path(manifest['source']).resolve() != source.resolve():
        raise RuntimeError('Source file differs from the previewed file.')
    if hashlib.sha256(source.read_bytes()).hexdigest() != manifest['source_sha256']:
        raise RuntimeError('Article changed after preview. Remove _post-preview and preview again.')
    date = datetime.fromisoformat(manifest['date'])
    result = prepare(source, date)
    for key in ('permalink', 'previous_path', 'previous_url', 'title'):
        if result[key] != manifest[key]:
            raise RuntimeError(f'Site changed since preview ({key}). Preview again.')
    article = ROOT / result['relative'] / 'index.html'
    previous = ROOT / result['previous_path']
    if not INDEXER.is_file():
        raise FileNotFoundError(f'Search index builder not found: {INDEXER}')
    old_index = ROOT / 'search-index.json'
    if not old_index.is_file():
        raise FileNotFoundError('Existing search-index.json missing')
    old_docs = json.loads(read(old_index))
    old_count = len(old_docs['documents'])
    prev_soup = soup_file(previous)
    nav_link(prev_soup, 'next', result['permalink'], result['title'])
    previous_html = str(prev_soup)
    # Back up all existing files before touching anything.
    backup = ROOT.parent / ('antilogicalism-publication-backup-' + datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
    backup.mkdir(parents=True, exist_ok=False)
    originals = {BLOG: BLOG.read_bytes(), previous: previous.read_bytes(), old_index: old_index.read_bytes()}
    for path, content in originals.items():
        copy_path = backup / path.relative_to(ROOT)
        copy_path.parent.mkdir(parents=True, exist_ok=True)
        copy_path.write_bytes(content)
    try:
        article.parent.mkdir(parents=True, exist_ok=False)
        article.write_text(result['article_html'], encoding='utf-8')
        BLOG.write_text(result['blog_html'], encoding='utf-8')
        previous.write_text(previous_html, encoding='utf-8')
        subprocess.run([sys.executable, str(INDEXER)], cwd=str(ROOT), check=True)
        new_docs = json.loads(read(old_index))
        new_count = len(new_docs['documents'])
        if new_count < old_count + 1:
            raise RuntimeError(f'Search index count did not increase: {old_count} -> {new_count}')
    except Exception:
        for path, content in originals.items():
            path.write_bytes(content)
        if article.exists():
            article.unlink()
        if article.parent.exists() and not any(article.parent.iterdir()):
            article.parent.rmdir()
        print('Publication failed; original website files restored.', file=sys.stderr)
        raise
    print('Published locally:', article)
    print('Blog and previous-post navigation updated.')
    print(f'Search documents: {old_count} -> {new_count}')
    print('Backup:', backup)
    print('Review locally, then commit and push using GitHub Desktop.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['preview', 'publish'])
    parser.add_argument('source', type=Path, help='UTF-8 Markdown file starting with # Title')
    parser.add_argument('--date', help='Publication date YYYY-MM-DD (preview only)')
    args = parser.parse_args()
    source = args.source.resolve()
    if not source.is_file():
        parser.error(f'Article not found: {source}')
    if args.action == 'publish':
        if args.date:
            parser.error('--date is only allowed for preview')
        publish(source)
    else:
        date = datetime.strptime(args.date, '%Y-%m-%d').replace(tzinfo=ZoneInfo('America/Detroit')) if args.date else datetime.now(ZoneInfo('America/Detroit'))
        preview(source, date)


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        sys.exit(1)
