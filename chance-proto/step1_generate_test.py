"""
Step 1, test A: can your Mac generate a background fast enough?

Generates one 512x512 scene with SD-Turbo on the Mac GPU (MPS),
times it 5 times, and saves the result as test_background.png.

Run:  python step1_generate_test.py
First run downloads the model (~2.5 GB) once.
"""
import time

import torch
from diffusers import AutoPipelineForText2Image

device = "mps" if torch.backends.mps.is_available() else "cpu"
print(f"Using device: {device}")
if device == "cpu":
    print("Warning: Mac GPU (MPS) not found. This will be very slow.")

print("Loading SD-Turbo (first time downloads the model)...")
pipe = AutoPipelineForText2Image.from_pretrained(
    "stabilityai/sd-turbo",
    torch_dtype=torch.float16,
    variant="fp16",
).to(device)

# A placeholder scene, like the ones the game will ask for after a draw
prompt = ("a crowded one-room home in a village in Bihar, 1987, "
          "morning light through a small window, simple ink line drawing on white paper")


def generate():
    return pipe(prompt, num_inference_steps=1, guidance_scale=0.0,
                width=512, height=512).images[0]


print("Warming up...")
generate()

times = []
for i in range(5):
    t0 = time.time()
    image = generate()
    times.append(time.time() - t0)
    print(f"  image {i + 1}: {times[-1]:.2f} s")

image.save("test_background.png")
avg = sum(times) / len(times)
print(f"\nAverage: {avg:.2f} s per image  ->  saved test_background.png")

# A black image means half precision failed on this Mac: switch torch.float16 to torch.float32 above.
if max(image.convert("L").getextrema()) < 10:
    print("The image came out black. Change torch.float16 to torch.float32 and run again.")
elif avg < 2:
    print("Good: fast enough to generate a new world while the dice roll.")
else:
    print("Slow for live use. We'll lean on pre-generated backgrounds.")
