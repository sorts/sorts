import re
# pyrefly: ignore [missing-import]
from scholarly import scholarly

def clean_bibtex_key(author_name, year, title):
    last_name = author_name.split()[0].lower() if author_name else "unknown"
    last_name = re.sub(r'[^a-z]', '', last_name)
    first_word = title.split()[0].lower() if title else "unknown"
    first_word = re.sub(r'[^a-z]', '', first_word)
    return f"{last_name}{year}{first_word}"

def main():
    print("Searching for author by ID...")
    try:
        author = scholarly.search_author_id('dznX1DMAAAAJ')
        print(f"Found author: {author.get('name', 'Unknown')}")
    except Exception as e:
        print(f"Author not found or error: {e}")
        return

    print("Fetching publications (this might take a few minutes)...")
    author = scholarly.fill(author, sections=['publications'])
    
    bibtex_entries = []
    for i, pub in enumerate(author['publications']):
        print(f"Fetching details for publication {i+1}/{len(author['publications'])}...")
        try:
            pub_filled = scholarly.fill(pub)
            bib = pub_filled.get('bib', {})
            title = bib.get('title', 'Unknown Title')
            authors = bib.get('author', '')
            year = bib.get('pub_year', 'unknown_year')
            venue = bib.get('venue', bib.get('journal', ''))
            
            key = clean_bibtex_key(authors, year, title)
            entry = f"@article{{{key},\n  title={{ {title} }},\n  author={{ {authors} }},\n"
            if year != 'unknown_year':
                entry += f"  year={{ {year} }},\n"
            if venue:
                entry += f"  journal={{ {venue} }}\n"
            entry += "}\n"
            bibtex_entries.append(entry)
        except Exception as e:
            print(f"Error fetching publication: {e}")

    with open('publications.bib', 'w', encoding='utf-8') as f:
        f.write('\n'.join(bibtex_entries))
        
    print(f"Successfully wrote {len(bibtex_entries)} publications to publications.bib")

if __name__ == "__main__":
    main()
