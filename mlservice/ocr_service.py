import google.generativeai as genai
import os
import json
import re
from datetime import datetime
from typing import Dict, Any
from pathlib import Path
import aiofiles

class OCRService:
    def __init__(self):
        self.api_key = os.getenv("GEMINI_API_KEY")
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY environment variable is required")
        
        genai.configure(api_key=self.api_key)
        # Dynamically detect an available vision-capable model that supports generateContent
        self.model_names = self._detect_vision_models()
        if not self.model_names:
            # Reasonable fallbacks
            self.model_names = [
                "gemini-1.5-flash",
                "gemini-1.5-flash-latest",
                "gemini-1.0-pro-vision",
            ]
        print(f"[OCR] Model candidates: {self.model_names}")

    def _detect_vision_models(self):
        try:
            models = genai.list_models()
            names = []
            for m in models:
                # Some SDKs expose 'name' like 'models/gemini-1.5-flash', normalize it
                name = getattr(m, 'name', '') or ''
                if name.startswith('models/'):
                    name = name.split('models/')[-1]
                methods = set(getattr(m, 'supported_generation_methods', []) or [])
                if ('generateContent' in methods) and (
                    'vision' in name or 'flash' in name or 'pro-vision' in name
                ):
                    names.append(name)
            # Prefer 1.5 flash variants first
            names.sort(key=lambda n: (
                0 if '1.5' in n and 'flash' in n else 1,
                0 if 'flash' in n else 1,
                n
            ))
            return names
        except Exception:
            return []
        
    async def extract_receipt_data(self, file: Any) -> Dict[str, Any]:
        """Extract structured data from receipt image using Gemini Vision API"""
        try:
            # Persist upload to disk so the SDK can read by path
            upload_dir = Path(os.getenv("UPLOAD_DIR", "uploads"))
            upload_dir.mkdir(parents=True, exist_ok=True)
            suffix = Path(file.filename).suffix or ".jpg"
            safe_name = f"receipt_{int(datetime.now().timestamp())}{suffix}"
            save_path = upload_dir / safe_name

            async with aiofiles.open(save_path, 'wb') as out:
                while True:
                    chunk = await file.read(1024 * 1024)
                    if not chunk:
                        break
                    await out.write(chunk)

            # Prepare image/file part for Gemini (compat with older SDKs without upload_file)
            ext = save_path.suffix.lower()
            mime = 'image/png'
            if ext in ['.jpg', '.jpeg']:
                mime = 'image/jpeg'
            elif ext == '.pdf':
                mime = 'application/pdf'

            with open(save_path, 'rb') as f:
                file_bytes = f.read()
            image_part = {"mime_type": mime, "data": file_bytes}
            
            # Create prompt for receipt extraction
            prompt = """
            Analyze this receipt image and extract the following information in JSON format ONLY (no prose, no markdown):
            {
                "merchant": "store/company name",
                "date": "YYYY-MM-DD",
                "total_amount": "total amount as number",
                "items": [
                    {
                        "description": "item description",
                        "amount": "item amount as number"
                    }
                ],
                "category": "likely expense category (food, transportation, shopping, entertainment, etc.)",
                "confidence": "confidence score 0-1"
            }
            
            Rules:
            - Extract merchant name from header/top of receipt
            - Extract date in YYYY-MM-DD format (convert if printed as MM/DD/YYYY or DD-MM-YYYY)
            - Extract total amount (usually at bottom)
            - List main items purchased
            - Suggest appropriate category based on merchant and items
            - Return only valid JSON, no additional text
            """
            
            # Generate content with fallback across known model names
            response = None
            last_err = None
            for name in self.model_names:
                try:
                    model = genai.GenerativeModel(name)
                    response = model.generate_content([prompt, image_part])
                    if response and getattr(response, 'text', None):
                        break
                except Exception as e:
                    last_err = e
                    continue
            if response is None:
                raise RuntimeError(str(last_err) if last_err else "OCR model generation failed")
            
            # Parse JSON response
            try:
                # Clean the response text
                response_text = response.text.strip()
                
                # Remove any markdown formatting
                if response_text.startswith('```json'):
                    response_text = response_text[7:]
                if response_text.endswith('```'):
                    response_text = response_text[:-3]
                
                extracted_data = json.loads(response_text)
                
                # Validate and clean the data
                cleaned_data = self._clean_extracted_data(extracted_data)
                
                return {
                    "success": True,
                    "data": cleaned_data,
                    "raw_response": response.text
                }
                
            except json.JSONDecodeError as e:
                # If JSON parsing fails, try to extract data using regex
                cleaned_data = self._extract_with_regex(response.text)
                return {
                    "success": True,
                    "data": cleaned_data,
                    "raw_response": response.text,
                    "note": "Used regex extraction due to JSON parsing error"
                }
                
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "data": {
                    "merchant": "",
                    "date": datetime.now().strftime("%Y-%m-%d"),
                    "total_amount": 0.0,
                    "items": [],
                    "category": "other",
                    "confidence": 0.0,
                }
            }
    
    def _clean_extracted_data(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Clean and validate extracted data"""
        cleaned = {}
        
        # Clean merchant name
        if "merchant" in data:
            cleaned["merchant"] = str(data["merchant"]).strip()
        
        # Clean and validate date
        if "date" in data:
            date_str = str(data["date"]).strip()
            try:
                # Try to parse the date
                parsed_date = datetime.strptime(date_str, "%Y-%m-%d")
                cleaned["date"] = parsed_date.strftime("%Y-%m-%d")
            except ValueError:
                # Try other common formats
                for fmt in ["%m/%d/%Y", "%d/%m/%Y", "%Y-%m-%d"]:
                    try:
                        parsed_date = datetime.strptime(date_str, fmt)
                        cleaned["date"] = parsed_date.strftime("%Y-%m-%d")
                        break
                    except ValueError:
                        continue
                else:
                    cleaned["date"] = datetime.now().strftime("%Y-%m-%d")
        
        # Clean total amount
        if "total_amount" in data:
            try:
                amount = float(str(data["total_amount"]).replace("₹", "").replace("$", "").replace(",", "").replace("rs", "").replace("RS", "").replace("Rs", ""))
                cleaned["total_amount"] = abs(amount)  # Make sure it's positive
            except ValueError:
                cleaned["total_amount"] = 0.0
        
        # Clean items
        if "items" in data and isinstance(data["items"], list):
            cleaned["items"] = []
            for item in data["items"]:
                if isinstance(item, dict):
                    cleaned_item = {}
                    if "description" in item:
                        cleaned_item["description"] = str(item["description"]).strip()
                    if "amount" in item:
                        try:
                            amount = float(str(item["amount"]).replace("₹", "").replace("$", "").replace(",", "").replace("rs", "").replace("RS", "").replace("Rs", ""))
                            cleaned_item["amount"] = abs(amount)
                        except ValueError:
                            cleaned_item["amount"] = 0.0
                    cleaned["items"].append(cleaned_item)
        
        # Clean category
        if "category" in data:
            cleaned["category"] = str(data["category"]).strip().lower()
        
        # Clean confidence
        if "confidence" in data:
            try:
                confidence = float(data["confidence"])
                cleaned["confidence"] = max(0.0, min(1.0, confidence))
            except (ValueError, TypeError):
                cleaned["confidence"] = 0.8  # Default confidence
        
        return cleaned
    
    def _extract_with_regex(self, text: str) -> Dict[str, Any]:
        """Fallback method to extract data using regex patterns"""
        cleaned_data = {}
        
        # Extract merchant (look for common patterns)
        merchant_patterns = [
            r"merchant[:\s]+([^\n]+)",
            r"store[:\s]+([^\n]+)",
            r"company[:\s]+([^\n]+)"
        ]
        
        for pattern in merchant_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                cleaned_data["merchant"] = match.group(1).strip()
                break
        
        # Extract date
        date_patterns = [
            r"(\d{4}-\d{2}-\d{2})",        # YYYY-MM-DD
            r"(\d{2}/\d{2}/\d{4})",        # MM/DD/YYYY
            r"(\d{1,2}/\d{1,2}/\d{4})",    # M/D/YYYY
            r"(\d{2}-\d{2}-\d{4})",        # DD-MM-YYYY
            r"(\d{1,2}-\d{1,2}-\d{4})"     # D-M-YYYY
        ]
        
        for pattern in date_patterns:
            match = re.search(pattern, text)
            if match:
                cleaned_data["date"] = match.group(1)
                break
        
        # Extract total amount
        amount_patterns = [
            r"total[:\s]+(?:rs\.?\s*|₹\s*|\$\s*)?([\d,]+\.?\d*)",
            r"amount[:\s]+(?:rs\.?\s*|₹\s*|\$\s*)?([\d,]+\.?\d*)",
            r"[₹$]([\d,]+\.?\d*)",
            r"rs\.?\s*([\d,]+\.?\d*)"
        ]
        
        for pattern in amount_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                try:
                    amount = float(match.group(1).replace(",", ""))
                    cleaned_data["total_amount"] = abs(amount)
                    break
                except ValueError:
                    continue
        
        # Default values
        if "merchant" not in cleaned_data:
            cleaned_data["merchant"] = "Unknown Merchant"
        if "date" not in cleaned_data:
            cleaned_data["date"] = datetime.now().strftime("%Y-%m-%d")
        if "total_amount" not in cleaned_data:
            cleaned_data["total_amount"] = 0.0
        if "category" not in cleaned_data:
            cleaned_data["category"] = "other"
        if "confidence" not in cleaned_data:
            cleaned_data["confidence"] = 0.6
        
        return cleaned_data
