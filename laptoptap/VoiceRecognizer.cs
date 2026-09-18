using System;
using System.IO;
using System.Speech.Recognition;

namespace LaptopTap
{
    class Program
    {
        static void Main(string[] args)
        {
            Console.OutputEncoding = System.Text.Encoding.UTF8;
            Console.WriteLine("STATUS:STARTING");

            float minConfidence = 0.64f;
            float parsed;
            if (args.Length > 0 && float.TryParse(args[0], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out parsed))
            {
                minConfidence = parsed;
            }

            SpeechRecognitionEngine engine = null;
            try
            {
                engine = new SpeechRecognitionEngine();
                engine.SetInputToDefaultAudioDevice();

                // Define voice commands
                Choices choices = new Choices();
                
                // Copy commands
                choices.Add("copy");
                choices.Add("copy that");
                choices.Add("copy this");

                // Paste commands
                choices.Add("paste");
                choices.Add("paste that");
                choices.Add("paste here");

                // Screenshot commands
                choices.Add("screenshot");
                choices.Add("take screenshot");

                // Safe Lock commands (multi-word only to avoid "knock" acoustic confusion)
                choices.Add("lock pc");
                choices.Add("lock screen");
                choices.Add("lock computer");

                // Media commands
                choices.Add("play");
                choices.Add("pause");
                choices.Add("play music");
                choices.Add("pause music");
                choices.Add("next");
                choices.Add("next track");
                choices.Add("previous");
                choices.Add("previous track");
                choices.Add("mute");
                choices.Add("mute sound");

                GrammarBuilder gb = new GrammarBuilder(choices);
                Grammar grammar = new Grammar(gb);
                engine.LoadGrammar(grammar);

                engine.SpeechRecognized += (s, e) =>
                {
                    if (e.Result != null)
                    {
                        float conf = e.Result.Confidence;
                        string text = e.Result.Text.ToLower().Trim();

                        if (conf >= minConfidence)
                        {
                            string canonical = text;
                            if (text.StartsWith("copy")) canonical = "copy";
                            else if (text.StartsWith("paste")) canonical = "paste";
                            else if (text.Contains("screenshot")) canonical = "screenshot";
                            else if (text.StartsWith("lock")) canonical = "lock";
                            else if (text.StartsWith("play")) canonical = "play";
                            else if (text.StartsWith("pause")) canonical = "pause";
                            else if (text.Contains("next")) canonical = "next";
                            else if (text.Contains("previous")) canonical = "previous";
                            else if (text.Contains("mute")) canonical = "mute";

                            Console.WriteLine("VOICE_CMD:" + canonical + ":" + conf.ToString("F2") + ":" + text);
                            Console.Out.Flush();
                        }
                        else
                        {
                            Console.WriteLine("DEBUG_LOW_CONF:" + text + ":" + conf.ToString("F2"));
                            Console.Out.Flush();
                        }
                    }
                };

                Console.WriteLine("STATUS:READY");
                Console.Out.Flush();

                // Start continuous asynchronous recognition
                engine.RecognizeAsync(RecognizeMode.Multiple);

                // Wait for exit command from stdin
                string line;
                while ((line = Console.ReadLine()) != null)
                {
                    if (line.Trim().ToLower() == "quit" || line.Trim().ToLower() == "exit")
                    {
                        break;
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("ERROR:" + ex.Message);
                Console.Out.Flush();
            }
            finally
            {
                if (engine != null)
                {
                    try
                    {
                        engine.RecognizeAsyncStop();
                        engine.Dispose();
                    }
                    catch { }
                }
                Console.WriteLine("STATUS:STOPPED");
            }
        }
    }
}
