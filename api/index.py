from market import app
from flask import request, Response
import json

# For Vercel, we need to make the app available
app = app

# Add CORS headers to allow requests
@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
    return response

if __name__ == '__main__':
    app.run()
