import os
import re
import time
import threading
from pathlib import Path
from flask import Flask, request, jsonify
import chromadb
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

VAULT_PATH = os.getenv('VAULT_PATH', './vault')
CHROMA_PATH = os.getenv('CHROMA_PATH', './chroma')

app = Flask(__name__)
chroma_client = chromadb.PersistentClient(path=CHROMA_PATH)
collection = chroma_client.get_or_create_collection(name='vault')

def parse_note(filepath):
    text = Path(filepath).read_text(encoding='utf8')
    task_match = re.search(r'task: "(.+?)"', text)
    task = task_match.group(1) if task_match else Path(filepath).stem
    # Strip frontmatter
    body = re.sub(r'---[\s\S]+?---', '', text).strip()
    return task, body

def index_note(filepath):
    filename = Path(filepath).stem
    try:
        task, body = parse_note(filepath)
        # Combine task + body so both are searchable
        document = f"{task}\n\n{body}"
        # Upsert so re-indexing is safe
        collection.upsert(
            documents=[document],
            metadatas=[{'filename': filename, 'task': task, 'filepath': str(filepath)}],
            ids=[filename]
        )
        print(f'  Indexed: {filename}')
    except Exception as e:
        print(f'  Failed to index {filename}: {e}')

def index_vault():
    vault = Path(VAULT_PATH)
    if not vault.exists():
        print(f'Vault path not found: {VAULT_PATH}')
        return
    notes = list(vault.glob('*.md'))
    print(f'Indexing {len(notes)} notes from vault...')
    for note in notes:
        index_note(note)
    print(f'Done. {len(notes)} notes indexed.')

# Watchdog handler — auto-indexes new or modified vault files
class VaultHandler(FileSystemEventHandler):
    def on_created(self, event):
        if not event.is_directory and event.src_path.endswith('.md'):
            time.sleep(0.5)  # brief wait for file to finish writing
            print(f'New note detected: {event.src_path}')
            index_note(event.src_path)

    def on_modified(self, event):
        if not event.is_directory and event.src_path.endswith('.md'):
            time.sleep(0.5)
            print(f'Note updated: {event.src_path}')
            index_note(event.src_path)

@app.route('/search', methods=['POST'])
def search():
    data = request.json
    query = data.get('query', '')
    n_results = data.get('n_results', 3)

    if not query:
        return jsonify({'error': 'No query provided'}), 400

    try:
        count = collection.count()
        if count == 0:
            return jsonify({'results': [], 'message': 'Vault is empty'})

        # Clamp results to what's available
        n = min(n_results, count)
        results = collection.query(query_texts=[query], n_results=n)

        formatted = []
        for i in range(len(results['ids'][0])):
            formatted.append({
                'filename': results['metadatas'][0][i]['filename'],
                'task': results['metadatas'][0][i]['task'],
                'body': results['documents'][0][i][:800],
                'distance': results['distances'][0][i]
            })

        return jsonify({'results': formatted})

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'notes_indexed': collection.count()})

if __name__ == '__main__':
    # Index existing vault on startup
    index_vault()

    # Start file watcher in background thread
    vault = Path(VAULT_PATH)
    vault.mkdir(exist_ok=True)
    observer = Observer()
    observer.schedule(VaultHandler(), str(vault), recursive=False)
    observer.start()
    print(f'Watching vault at {VAULT_PATH} for new notes...')

    # Start Flask server
    print('Search service running on http://localhost:5001')
    app.run(port=5001, debug=False)
