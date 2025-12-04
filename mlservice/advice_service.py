import google.generativeai as genai
import os
import json
from typing import Dict, List, Any
from datetime import datetime

class AdviceService:
    def __init__(self):
        self.api_key = os.getenv("GEMINI_API_KEY")
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY environment variable is required")
        
        genai.configure(api_key=self.api_key)
        self.model_names = self._detect_text_models()
        if not self.model_names:
            self.model_names = [
                "gemini-1.5-flash",
                "gemini-1.0-pro",
                "gemini-pro",
            ]
        print(f"[Advice] Model candidates: {self.model_names}")

    def _detect_text_models(self):
        try:
            models = genai.list_models()
            names = []
            for m in models:
                name = getattr(m, 'name', '') or ''
                if name.startswith('models/'):
                    name = name.split('models/')[-1]
                methods = set(getattr(m, 'supported_generation_methods', []) or [])
                if 'generateContent' in methods:
                    # Prefer non-vision text models first
                    names.append(name)
            names.sort(key=lambda n: (
                0 if '1.5' in n and 'flash' in n else 1,
                0 if 'pro' in n else 1,
                n
            ))
            return names
        except Exception:
            return []
    
    def generate_advice(self, current_spending: List[Dict], budgets: List[Dict], 
                      predictions: List[Dict], user_id: int, 
                      monthly_spending: Dict[str, Dict[str, float]] = None,
                      analysis_period_months: int = 3) -> Dict[str, Any]:
        """Generate personalized financial advice using Gemini LLM"""
        try:
            # Prepare data for analysis
            analysis_data = self._prepare_analysis_data(
                current_spending, budgets, predictions, 
                monthly_spending, analysis_period_months
            )
            
            # Create prompt for Gemini
            prompt = self._create_advice_prompt(analysis_data)
            
            # Generate advice
            response = None
            last_err = None
            for name in self.model_names:
                try:
                    model = genai.GenerativeModel(name)
                    response = model.generate_content(prompt)
                    if response and getattr(response, 'text', None):
                        break
                except Exception as e:
                    last_err = e
                    continue
            if response is None:
                raise RuntimeError(str(last_err) if last_err else "Advice model generation failed")
            
            # Parse response
            advice_data = self._parse_advice_response(response.text)
            
            return {
                "success": True,
                "advice": advice_data,
                "raw_response": response.text,
                "generated_at": datetime.now().isoformat()
            }
            
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "advice": self._get_fallback_advice()
            }
    
    def generate_advice_stream(self, current_spending: List[Dict], budgets: List[Dict], 
                              predictions: List[Dict], user_id: int, 
                              monthly_spending: Dict[str, Dict[str, float]] = None,
                              analysis_period_months: int = 3):
        """Stream advice generation as it's being created"""
        try:
            # Prepare data for analysis
            analysis_data = self._prepare_analysis_data(
                current_spending, budgets, predictions, 
                monthly_spending, analysis_period_months
            )
            
            # Create prompt for Gemini
            prompt = self._create_advice_prompt(analysis_data)
            
            # Stream response from Gemini
            response_text = ""
            for name in self.model_names:
                try:
                    model = genai.GenerativeModel(name)
                    # Stream the response
                    response = model.generate_content(prompt, stream=True)
                    
                    for chunk in response:
                        if hasattr(chunk, 'text') and chunk.text:
                            response_text += chunk.text
                            yield {'type': 'chunk', 'text': chunk.text, 'partial': True}
                    
                    if response_text:
                        break
                except Exception as e:
                    continue
            
            # Parse final response
            if response_text:
                advice_data = self._parse_advice_response(response_text)
                yield {'type': 'complete', 'advice': advice_data, 'success': True}
            else:
                fallback = self._get_fallback_advice()
                yield {'type': 'complete', 'advice': fallback, 'success': False}
                
        except Exception as e:
            yield {'type': 'error', 'error': str(e)}
    
    def _prepare_analysis_data(self, current_spending: List[Dict], 
                            budgets: List[Dict], predictions: List[Dict],
                            monthly_spending: Dict[str, Dict[str, float]] = None,
                            analysis_period_months: int = 3) -> Dict[str, Any]:
        """Prepare data for analysis"""
        # Calculate current month totals
        current_totals = {}
        for spending in current_spending:
            category = spending.get('category', 'other')
            amount = abs(float(spending.get('total', 0)))
            current_totals[category] = current_totals.get(category, 0) + amount
        
        # Process 3-month spending trends
        monthly_trends = {}
        category_trends = {}
        if monthly_spending:
            # Sort months chronologically
            sorted_months = sorted(monthly_spending.keys())
            for month in sorted_months:
                monthly_trends[month] = monthly_spending[month]
                # Track trends by category
                for category, amount in monthly_spending[month].items():
                    if category not in category_trends:
                        category_trends[category] = []
                    category_trends[category].append(amount)
        
        # Calculate trend indicators (increasing, decreasing, stable)
        category_analysis = {}
        for category, amounts in category_trends.items():
            if len(amounts) >= 2:
                recent_avg = sum(amounts[-2:]) / 2  # Last 2 months average
                earlier_avg = sum(amounts[:-2]) / len(amounts[:-2]) if len(amounts) > 2 else amounts[0]
                change_pct = ((recent_avg - earlier_avg) / earlier_avg * 100) if earlier_avg > 0 else 0
                category_analysis[category] = {
                    'trend': 'increasing' if change_pct > 10 else 'decreasing' if change_pct < -10 else 'stable',
                    'change_percentage': round(change_pct, 1),
                    'monthly_average': round(sum(amounts) / len(amounts), 2)
                }
        
        # Calculate budget status
        budget_status = {}
        for budget in budgets:
            category = budget.get('category', 'other')
            limit = float(budget.get('limit_amount', 0))
            spent = current_totals.get(category, 0)
            remaining = limit - spent
            percentage = (spent / limit * 100) if limit > 0 else 0
            
            budget_status[category] = {
                'limit': limit,
                'spent': spent,
                'remaining': remaining,
                'percentage': percentage,
                'status': 'over' if percentage > 100 else 'warning' if percentage > 80 else 'good'
            }
        
        # Prepare predictions summary
        predictions_summary = {}
        for prediction in predictions:
            category = prediction.get('category', 'other')
            amount = float(prediction.get('predicted_amount', 0))
            predictions_summary[category] = amount
        
        # Calculate 3-month totals
        three_month_total = 0
        if monthly_spending:
            for month_data in monthly_spending.values():
                three_month_total += sum(month_data.values())
        
        return {
            'current_spending': current_totals,
            'monthly_spending': monthly_trends,
            'category_trends': category_analysis,
            'budget_status': budget_status,
            'predictions': predictions_summary,
            'total_current_spending': sum(current_totals.values()),
            'total_three_month_spending': three_month_total,
            'average_monthly_spending': round(three_month_total / analysis_period_months, 2) if analysis_period_months > 0 else 0,
            'total_predicted_spending': sum(predictions_summary.values()),
            'analysis_period_months': analysis_period_months
        }
    
    def _create_advice_prompt(self, analysis_data: Dict[str, Any]) -> str:
        """Create prompt for Gemini LLM"""
        period_months = analysis_data.get('analysis_period_months', 3)
        
        prompt = f"""
        You are a personal finance advisor AI. Analyze the following financial data from the last {period_months} months and provide personalized, actionable advice.

        CURRENT MONTH SPENDING:
        {json.dumps(analysis_data['current_spending'], indent=2)}

        MONTHLY SPENDING BREAKDOWN (Last {period_months} Months):
        {json.dumps(analysis_data.get('monthly_spending', {}), indent=2)}

        SPENDING TRENDS BY CATEGORY:
        {json.dumps(analysis_data.get('category_trends', {}), indent=2)}

        BUDGET STATUS:
        {json.dumps(analysis_data['budget_status'], indent=2)}

        NEXT MONTH PREDICTIONS:
        {json.dumps(analysis_data['predictions'], indent=2)}

        SPENDING SUMMARY:
        - Current Month Total: ₹{analysis_data['total_current_spending']:.2f}
        - {period_months}-Month Total: ₹{analysis_data.get('total_three_month_spending', 0):.2f}
        - Average Monthly Spending: ₹{analysis_data.get('average_monthly_spending', 0):.2f}
        - Predicted Next Month: ₹{analysis_data['total_predicted_spending']:.2f}

        Please provide:
        1. A brief summary of their financial situation over the last {period_months} months, highlighting trends and patterns
        2. Specific areas of concern (budget overruns, increasing spending trends, high spending categories)
        3. 3-5 actionable recommendations to improve their finances based on the {period_months}-month analysis
        4. Positive reinforcement for good financial habits or improvements you notice
        5. A confidence score (0-100) for your advice based on the data quality

        When analyzing trends:
        - Identify categories with increasing spending that may need attention
        - Note categories with decreasing spending as positive changes
        - Compare current month spending to the {period_months}-month average
        - Consider seasonal patterns if visible

        Format your response as JSON with the following structure:
        {{
            "summary": "Brief summary of financial situation over the last {period_months} months, including trends",
            "concerns": ["List of specific concerns based on trends and current spending"],
            "recommendations": [
                {{
                    "title": "Recommendation title",
                    "description": "Detailed description based on {period_months}-month analysis",
                    "priority": "high/medium/low",
                    "potential_savings": "Estimated savings amount"
                }}
            ],
            "positive_feedback": ["List of positive observations from the {period_months}-month data"],
            "confidence_score": 85,
            "next_steps": ["Immediate action items based on trends"]
        }}

        Keep advice practical, encouraging, and specific. Focus on actionable steps based on the {period_months}-month spending patterns rather than generic advice.
        """
        
        return prompt
    
    def _parse_advice_response(self, response_text: str) -> Dict[str, Any]:
        """Parse Gemini response and extract structured advice"""
        try:
            # Clean the response text
            response_text = response_text.strip()
            
            # Remove any markdown formatting
            if response_text.startswith('```json'):
                response_text = response_text[7:]
            if response_text.endswith('```'):
                response_text = response_text[:-3]
            
            # Try to parse JSON
            advice_data = json.loads(response_text)
            
            # Validate required fields
            required_fields = ['summary', 'concerns', 'recommendations', 'positive_feedback', 'confidence_score']
            for field in required_fields:
                if field not in advice_data:
                    advice_data[field] = self._get_default_value(field)
            
            return advice_data
            
        except json.JSONDecodeError:
            # If JSON parsing fails, extract information using text parsing
            return self._extract_advice_from_text(response_text)
    
    def _get_default_value(self, field: str) -> Any:
        """Get default value for missing fields"""
        defaults = {
            'summary': 'Unable to analyze financial data at this time.',
            'concerns': ['Unable to identify specific concerns'],
            'recommendations': [{
                'title': 'Review your spending',
                'description': 'Take time to review your recent transactions and identify areas for improvement.',
                'priority': 'medium',
                'potential_savings': 'Variable'
            }],
            'positive_feedback': ['You are actively tracking your finances, which is a great start!'],
            'confidence_score': 50,
            'next_steps': ['Continue monitoring your spending patterns']
        }
        return defaults.get(field, '')
    
    def _extract_advice_from_text(self, text: str) -> Dict[str, Any]:
        """Extract advice from unstructured text response"""
        import re
        
        # Extract summary (first paragraph)
        summary_match = re.search(r'^(.+?)(?:\n\n|\n[A-Z]|$)', text, re.MULTILINE | re.DOTALL)
        summary = summary_match.group(1).strip() if summary_match else "Financial analysis completed."
        
        # Extract concerns (look for keywords)
        concerns = []
        concern_keywords = ['over budget', 'exceed', 'high spending', 'concern', 'warning']
        for keyword in concern_keywords:
            if keyword.lower() in text.lower():
                concerns.append(f"Potential issue detected: {keyword}")
        
        # Extract recommendations (look for numbered lists or bullet points)
        recommendations = []
        rec_pattern = r'(?:^|\n)(?:\d+\.|\*|\-)\s*(.+?)(?:\n|$)'
        rec_matches = re.findall(rec_pattern, text, re.MULTILINE)
        for i, match in enumerate(rec_matches[:5]):  # Limit to 5 recommendations
            recommendations.append({
                'title': f'Recommendation {i+1}',
                'description': match.strip(),
                'priority': 'medium',
                'potential_savings': 'Variable'
            })
        
        # Default recommendations if none found
        if not recommendations:
            recommendations = [{
                'title': 'Review Spending Patterns',
                'description': 'Analyze your spending habits and identify areas for improvement.',
                'priority': 'medium',
                'potential_savings': 'Variable'
            }]
        
        return {
            'summary': summary,
            'concerns': concerns if concerns else ['No specific concerns identified'],
            'recommendations': recommendations,
            'positive_feedback': ['You are taking steps to manage your finances effectively.'],
            'confidence_score': 60,
            'next_steps': ['Continue tracking your expenses and reviewing your budget regularly.']
        }
    
    def _get_fallback_advice(self) -> Dict[str, Any]:
        """Get fallback advice when Gemini is unavailable"""
        return {
            'summary': 'Your financial data has been analyzed. Here are some general recommendations to help improve your financial health.',
            'concerns': ['Unable to analyze specific concerns at this time'],
            'recommendations': [
                {
                    'title': 'Track Your Expenses',
                    'description': 'Continue recording all your transactions to get better insights into your spending patterns.',
                    'priority': 'high',
                    'potential_savings': 'Helps identify saving opportunities'
                },
                {
                    'title': 'Review Your Budget',
                    'description': 'Regularly check your budget against actual spending to ensure you stay on track.',
                    'priority': 'high',
                    'potential_savings': 'Prevents overspending'
                },
                {
                    'title': 'Set Financial Goals',
                    'description': 'Define clear financial objectives to stay motivated and focused.',
                    'priority': 'medium',
                    'potential_savings': 'Long-term financial improvement'
                }
            ],
            'positive_feedback': ['You are actively managing your finances by using this platform.'],
            'confidence_score': 40,
            'next_steps': ['Continue using the platform regularly for better insights.']
        }
    
    def generate_category_advice(self, category: str, spending_amount: float, 
                               budget_limit: float = None) -> Dict[str, Any]:
        """Generate specific advice for a spending category"""
        try:
            prompt = f"""
            Provide specific financial advice for someone who spent ₹{spending_amount:.2f} on {category}.
            {"Their budget limit for this category is ₹" + str(budget_limit) + "." if budget_limit else ""}
            
            Give 2-3 specific, actionable recommendations for this category.
            Format as JSON: {{"recommendations": ["advice1", "advice2", "advice3"]}}
            """
            
            response = self.model.generate_content(prompt)
            
            try:
                advice_data = json.loads(response.text.strip())
                return {
                    "success": True,
                    "category": category,
                    "recommendations": advice_data.get("recommendations", [])
                }
            except json.JSONDecodeError:
                return {
                    "success": True,
                    "category": category,
                    "recommendations": [
                        f"Consider reviewing your {category} spending patterns",
                        f"Look for ways to optimize your {category} expenses",
                        f"Set specific goals for {category} spending"
                    ]
                }
                
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "recommendations": [
                    f"Review your {category} spending",
                    f"Consider setting a budget for {category}",
                    f"Look for cost-saving opportunities in {category}"
                ]
            }
