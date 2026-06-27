<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Fun Facts Generator</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }

        .container {
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            max-width: 600px;
            width: 100%;
            padding: 40px;
            text-align: center;
            animation: slideIn 0.5s ease-out;
        }

        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateY(-20px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        h1 {
            color: #667eea;
            font-size: 2.5em;
            margin-bottom: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
        }

        .emoji {
            font-size: 1.2em;
        }

        .subtitle {
            color: #999;
            font-size: 1em;
            margin-bottom: 30px;
        }

        .fact-box {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            border-radius: 15px;
            margin: 30px 0;
            font-size: 1.3em;
            line-height: 1.6;
            min-height: 120px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 10px 30px rgba(102, 126, 234, 0.4);
            animation: fadeIn 0.5s ease-out;
        }

        @keyframes fadeIn {
            from {
                opacity: 0;
            }
            to {
                opacity: 1;
            }
        }

        .fact-text {
            font-weight: 500;
        }

        .button-group {
            display: flex;
            gap: 15px;
            margin-top: 30px;
            flex-wrap: wrap;
            justify-content: center;
        }

        button {
            flex: 1;
            min-width: 150px;
            padding: 15px 30px;
            font-size: 1em;
            border: none;
            border-radius: 10px;
            cursor: pointer;
            font-weight: 600;
            transition: all 0.3s ease;
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        .btn-next {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }

        .btn-next:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 25px rgba(102, 126, 234, 0.4);
        }

        .btn-next:active {
            transform: translateY(0);
        }

        .btn-copy {
            background: #f0f0f0;
            color: #333;
            border: 2px solid #667eea;
        }

        .btn-copy:hover {
            background: #667eea;
            color: white;
            transform: translateY(-2px);
        }

        .btn-copy:active {
            transform: translateY(0);
        }

        .fact-counter {
            color: #999;
            font-size: 0.9em;
            margin-top: 20px;
        }

        .copy-notification {
            position: fixed;
            top: 20px;
            right: 20px;
            background: #4caf50;
            color: white;
            padding: 15px 20px;
            border-radius: 8px;
            display: none;
            animation: slideInRight 0.3s ease-out;
            z-index: 1000;
        }

        @keyframes slideInRight {
            from {
                transform: translateX(400px);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }

        .copy-notification.show {
            display: block;
        }

        @media (max-width: 600px) {
            .container {
                padding: 25px;
            }

            h1 {
                font-size: 1.8em;
            }

            .fact-box {
                font-size: 1.1em;
                padding: 20px;
            }

            button {
                min-width: 120px;
                padding: 12px 20px;
                font-size: 0.9em;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>
            <span class="emoji">🎯</span>
            Fun Facts Generator
        </h1>
        <p class="subtitle">Learn something amazing every day!</p>

        <div class="fact-box">
            <div class="fact-text" id="factText">Click the button to discover a fun fact!</div>
        </div>

        <div class="button-group">
            <button class="btn-next" onclick="getRandomFact()">Get Random Fact</button>
            <button class="btn-copy" onclick="copyToClipboard()">📋 Copy Fact</button>
        </div>

        <div class="fact-counter">
            <span id="factCounter">Facts viewed: 0</span>
        </div>
    </div>

    <div class="copy-notification" id="notification">
        ✓ Fact copied to clipboard!
    </div>

    <script>
        const facts = [
            "🐙 Octopuses have three hearts and blue blood!",
            "🍌 Bananas are berries, but strawberries aren't!",
            "🦖 A dinosaur's neck contained 15 times more bones than a giraffe's!",
            "🎓 Honey never spoils and can last for thousands of years!",
            "🧠 Your brain generates enough electricity to power a small lightbulb!",
            "👅 You cannot hum while holding your nose closed!",
            "🦗 Crickets don't have ears; they hear through their legs!",
            "☁️ A cloud weighs about 1.1 million pounds but still floats!",
            "💎 Diamonds rain on Jupiter and Saturn!",
            "🐝 Bees waggle dance to communicate food locations!",
            "🦁 A lion's roar can be heard from 5 miles away!",
            "🧊 Antarctica is the driest place on Earth!",
            "🐢 Sea turtles can live for over 100 years!",
            "🌍 If you could drive straight up, you'd reach space in about 1 hour!",
            "🐠 Goldfish have a memory span of 3 months!",
            "👀 Your eyes can distinguish about 10 million different colors!",
            "🦐 Shrimp have transparent heads so they can see inside!",
            "📚 The smell of books comes from over 200 organic compounds!",
            "⏱️ A day on Venus is longer than its year!",
            "🌙 The Moon is moving away from Earth at 1.6 inches per year!",
            "🦌 Reindeers are the only mammals that see ultraviolet light!",
            "🧬 Your body replaces about 1% of your cells every day!",
            "🐫 A camel can drink 40 gallons of water in 13 minutes!",
            "⚡ Lightning strikes Earth about 100 times every second!",
            "🦑 A squid's eye is as big as a dinner plate!"
        ];

        let factIndex = 0;
        let factsViewed = 0;

        function getRandomFact() {
            const randomIndex = Math.floor(Math.random() * facts.length);
            document.getElementById('factText').textContent = facts[randomIndex];
            factsViewed++;
            document.getElementById('factCounter').textContent = `Facts viewed: ${factsViewed}`;
        }

        function copyToClipboard() {
            const factText = document.getElementById('factText').textContent;
            navigator.clipboard.writeText(factText).then(() => {
                const notification = document.getElementById('notification');
                notification.classList.add('show');
                setTimeout(() => {
                    notification.classList.remove('show');
                }, 2000);
            });
        }

        // Load a fact when page loads
        window.addEventListener('load', () => {
            getRandomFact();
        });
    </script>
</body>
</html>
