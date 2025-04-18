import secrets
import base64
import os

def generate_encryption_key(length=32):
    """
    Generate a secure random encryption key
    :param length: Length of the key in bytes (32 = 256 bits)
    :return: Base64 encoded key
    """
    # Generate secure random bytes
    key_bytes = secrets.token_bytes(length)
    
    # Encode to base64 for storage
    key_b64 = base64.b64encode(key_bytes).decode('utf-8')
    
    print(f"Generated encryption key: {key_b64}")
    print("Store this key securely and add it to your .env file as ENCRYPTION_KEY")
    
    # Optionally write to env file if it exists
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env')
    
    if os.path.exists(env_path):
        with open(env_path, 'r') as file:
            env_content = file.read()
        
        if 'ENCRYPTION_KEY=replace_with_generated_key' in env_content:
            env_content = env_content.replace('ENCRYPTION_KEY=replace_with_generated_key', f'ENCRYPTION_KEY={key_b64}')
            
            with open(env_path, 'w') as file:
                file.write(env_content)
            print("Updated .env file with the new encryption key")
    
    return key_b64

if __name__ == "__main__":
    generate_encryption_key() 